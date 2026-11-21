import { z } from "zod";

const base64Key = z.string().refine((value) => {
  const bytes = Buffer.from(value, "base64");
  const canonical = bytes.toString("base64");
  return bytes.length === 32 && (value === canonical || value === canonical.slice(0, -1));
}, "Se requieren 32 bytes en base64.");
const jwkCoordinate = z.base64url().refine((value) => Buffer.from(value, "base64url").length === 32, "Se requieren 32 bytes en base64url.");
const ed25519Key = z.object({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: jwkCoordinate });
const publicKey = ed25519Key.extend({ d: z.never().optional() });

function json<S extends z.ZodType>(schema: S) {
  return z.string().transform((value, ctx): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Se requiere JSON válido." });
      return z.NEVER;
    }
  }).pipe(z.unknown().transform((value, ctx): z.output<S> => {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    ctx.addIssue({ code: "custom", message: "La estructura de la clave Ed25519 no es válida." });
    return z.NEVER;
  }));
}

function optional<T>(value: T) {
  return value === "" ? undefined : value;
}

const settings = z.object({
  NODE_ENV: z.string().optional(),
  BROKER_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  BROKER_PORT: z.coerce.number().int().min(1).max(65_535),
  DATABASE_URL: z.preprocess(optional, z.url({ protocol: /^postgres(ql)?$/ }).optional()),
  BROKER_SIGNING_KEY: json(ed25519Key.extend({ d: jwkCoordinate })),
  NONCE_KEY: base64Key.transform((key) => Buffer.from(key, "base64")),
  WAKE_SECRETS_KEY: z.preprocess(optional, base64Key.optional()),
  REQUEST_TTL_SECONDS: z.coerce.number().int().min(1).max(2_147_483_647).default(900),
  WAKE_RETRY_DELAYS_MS: z.string().regex(/^\d+,\d+$/, "Se requieren dos intervalos en milisegundos separados por coma.")
    .default("10000,30000")
    .transform((value) => value.split(",").map(Number))
    .pipe(z.array(z.number().int().min(0).max(2_147_483_647)).length(2)),
  // `admin` is optional: without it every /v1/admin/* request answers 401.
  SERVICE_JWT_PUBLIC_KEYS: json(z.object({ mcp: publicKey, web: publicKey, admin: publicKey.optional() })),
  WAKE_ALLOW_INSECURE: z.enum(["0", "1"]).default("0").transform((flag) => flag === "1"),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && env.WAKE_ALLOW_INSECURE) {
    ctx.addIssue({ code: "custom", path: ["WAKE_ALLOW_INSECURE"], message: "No se permite en producción." });
  }
  if (env.DATABASE_URL && !env.WAKE_SECRETS_KEY) {
    ctx.addIssue({ code: "custom", path: ["WAKE_SECRETS_KEY"], message: "Se requiere con DATABASE_URL." });
  }
});

export type BrokerEnv = z.output<typeof settings>;

export function readEnv(input: NodeJS.ProcessEnv): BrokerEnv {
  const result = settings.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map(({ path, code, message }) => {
    const explanation = code === "custom" ? message : "Falta el valor o el formato no es válido.";
    return `${path.join(".")} — ${explanation}`;
  });
  throw new Error(`Configuración inválida del broker. ${issues.join(" ")}`);
}
