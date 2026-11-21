import { randomUUID } from "node:crypto";
import { Owner, Principal } from "@team-31/protocol";
import { importJWK, jwtVerify, SignJWT, type JWK } from "jose";

import { parseScopes } from "./scopes.js";

type ServiceIssuer = "mcp" | "web";
type PublicKeys = Partial<Record<ServiceIssuer, JWK>>;

type MintOptions = { sub: string; privateKey: JWK } & (
  | { iss: "mcp"; azp: string; scopes?: Principal["scopes"] }
  | { iss: "web"; azp?: never; scopes?: never }
);

const ALGORITHM = "EdDSA";
const AUDIENCE = "broker";
const TTL = 60;

function requireId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("El token de servicio requiere una identidad.");
  }
}

async function importKey(jwk: JWK | undefined, privateKey: boolean) {
  if (jwk?.kty !== "OKP" || jwk.crv !== "Ed25519" ||
      (privateKey ? typeof jwk.d !== "string" : jwk.d !== undefined)) {
    throw new Error("Se requiere una clave Ed25519 válida para el token de servicio.");
  }

  return importJWK(jwk, ALGORITHM);
}

export async function mintServiceToken(options: MintOptions): Promise<string> {
  requireId(options.sub);
  const issuedAt = Math.floor(Date.now() / 1000);

  let claims = {};
  if (options.iss === "mcp") {
    requireId(options.azp);
    const principal = Principal.parse({
      userId: options.sub,
      agentId: options.azp,
      scopes: options.scopes ?? [],
    });
    claims = { azp: principal.agentId, scope: principal.scopes.join(" ") };
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(options.iss)
    .setAudience(AUDIENCE)
    .setSubject(options.sub)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + TTL)
    .setJti(randomUUID())
    .sign(await importKey(options.privateKey, true));
}

type ServiceIdentity = { mcp: Principal; web: Owner };

export function verifyServiceToken<I extends ServiceIssuer>(
  token: string,
  options: { publicKeys: PublicKeys; expectedIss: I },
): Promise<ServiceIdentity[I]>;
export async function verifyServiceToken(
  token: string,
  { publicKeys, expectedIss }: { publicKeys: PublicKeys; expectedIss: ServiceIssuer },
): Promise<Principal | Owner> {
  const { payload } = await jwtVerify(token, await importKey(publicKeys[expectedIss], false), {
    algorithms: [ALGORITHM],
    issuer: expectedIss,
    audience: AUDIENCE,
    maxTokenAge: TTL,
    requiredClaims: ["sub", "iat", "exp", "jti"],
  });

  requireId(payload.sub);
  requireId(payload.jti);

  if (expectedIss === "mcp") {
    requireId(payload.azp);
    if (typeof payload.scope !== "string") {
      throw new Error("Los permisos del token de servicio no son válidos.");
    }
    return Principal.parse({
      userId: payload.sub,
      agentId: payload.azp,
      scopes: parseScopes(payload.scope),
    });
  }

  return Owner.parse({ userId: payload.sub });
}
