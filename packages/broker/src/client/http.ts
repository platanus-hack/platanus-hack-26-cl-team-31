import { ErrorBody, type ErrorCode } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { BrokerError } from "../errors.js";

type Schema<Value> = {
  safeParse(input: unknown): { success: true; data: Value } | { success: false };
};

type HttpRoute<Value = unknown> = {
  method: string;
  path: string;
  params?: Schema<Record<string, string>>;
  query?: Schema<Record<string, string | number | undefined>>;
  body?: Schema<unknown>;
  status?: number;
  response: Schema<Value>;
};

type HttpInput = { params?: unknown; query?: unknown; body?: unknown };
type RouteInput<Route> = {
  [Key in keyof HttpInput & keyof Route]: Route[Key] extends Schema<infer Value> ? Value : never;
};

export type ClientOptions<Identity> = {
  baseUrl: string;
  getServiceToken: (identity: Identity) => Promise<string>;
  fetch?: typeof globalThis.fetch;
};

const timeoutMs = 10_000;
const retryStatuses = new Set([502, 503, 504]);
const errorIdFormat = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

const errorMessages = {
  unauthorized: "No se pudo autenticar la llamada al broker.",
  forbidden: "No tienes permiso para realizar esta operación.",
  not_found: "No se encontró el recurso solicitado.",
  invalid_input: "Los datos de la solicitud no son válidos.",
  conflict: "La solicitud entra en conflicto con el estado actual.",
  expired: "La solicitud ha vencido.",
  rate_limited: "Se alcanzó el límite de solicitudes.",
  internal: "No se pudo completar la llamada al broker.",
} satisfies Record<ErrorCode, string>;

function parseInput<Value>(schema: Schema<Value>, input: unknown): Value {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BrokerError("invalid_input", errorMessages.invalid_input);
  return parsed.data;
}

function buildUrl(baseUrl: string, route: HttpRoute, input: HttpInput): URL {
  let path = route.path;
  if (route.params) {
    const params = parseInput(route.params, input.params);
    path = path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key: string) => {
      const value = params[key];
      if (!value || value === "." || value === "..") {
        throw new BrokerError("invalid_input", errorMessages.invalid_input);
      }
      try {
        return encodeURIComponent(value);
      } catch {
        throw new BrokerError("invalid_input", errorMessages.invalid_input);
      }
    });
  }

  const url = new URL(path, baseUrl);
  if (route.query) {
    for (const [key, value] of Object.entries(parseInput(route.query, input.query))) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function encodeBody(schema: Schema<unknown>, input: unknown): string {
  const parsed = parseInput(schema, input);
  try {
    const body = JSON.stringify(parsed);
    // Los campos abiertos del protocolo también deben ser válidos tras serializarse.
    parseInput(schema, JSON.parse(body));
    return body;
  } catch {
    throw new BrokerError("invalid_input", errorMessages.invalid_input);
  }
}

function responseError(route: HttpRoute, input: unknown, errorId?: string): BrokerError {
  const parsed = ErrorBody.safeParse(input);
  const details = { errorId, stage: "response" } as const;
  if (!parsed.success) return new BrokerError("internal", errorMessages.internal, details);

  const { code, reason } = parsed.data.error;
  if (route === routes.agentConnectWake && code === "invalid_input" && reason) {
    return new BrokerError(code, reason, { ...details, reason });
  }
  return new BrokerError(code, errorMessages[code], details);
}

export function createHttpClient<Identity>(
  { baseUrl, getServiceToken, fetch: sendHttp = globalThis.fetch }: ClientOptions<Identity>,
  identitySchema: Schema<Identity>,
) {
  function request<Route extends HttpRoute>(
    route: Route,
    identity: Identity,
    ...args: keyof RouteInput<Route> extends never ? [input?: never] : [input: RouteInput<Route>]
  ): Promise<Route["response"] extends Schema<infer Value> ? Value : never>;
  async function request<Value>(
    route: HttpRoute<Value>,
    identity: Identity,
    input: HttpInput = {},
  ): Promise<Value> {
    const caller = parseInput(identitySchema, identity);
    let url: URL;
    try {
      url = buildUrl(baseUrl, route, input);
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      throw new BrokerError("internal", errorMessages.internal, { stage: "url" });
    }

    const body = route.body ? encodeBody(route.body, input.body) : undefined;
    let response: Response;
    let stage: "signing" | "transport" = "transport";
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const deadline = new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });

      const send = async () => {
        stage = "signing";
        signal.throwIfAborted();
        const serviceToken = Promise.resolve().then(() => getServiceToken(caller));
        const token = await Promise.race([serviceToken, deadline]);
        stage = "transport";
        return sendHttp(url, {
          method: route.method,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body,
          signal,
          cache: "no-store",
          redirect: "error",
        });
      };

      response = await send();
      if (route.method === "GET" && retryStatuses.has(response.status)) {
        await response.body?.cancel();
        response = await send();
      }
    } catch {
      throw new BrokerError("internal", errorMessages.internal, { stage });
    }

    const header = response.headers.get("X-Error-Id");
    const errorId = header && errorIdFormat.test(header) ? header : undefined;
    let payload: unknown;
    try {
      payload = response.status === 204 ? undefined : await response.json();
    } catch {
      throw new BrokerError("internal", errorMessages.internal, { errorId, stage: "decoding" });
    }

    if (!response.ok) throw responseError(route, payload, errorId);
    if (route.status !== undefined && response.status !== route.status) {
      throw new BrokerError("internal", errorMessages.internal, { errorId, stage: "response" });
    }

    const parsed = route.response.safeParse(payload);
    if (!parsed.success) throw new BrokerError("internal", errorMessages.internal, { errorId, stage: "response" });
    return parsed.data;
  }

  return request;
}
