import { verifyServiceToken } from "@team-31/auth/service";
import { BrokerError } from "@team-31/broker";
import type { AdminActor, Owner, Principal } from "@team-31/protocol";
import type { MiddlewareHandler } from "hono";

export type ServiceKeys = NonNullable<Parameters<typeof verifyServiceToken>[1]["publicKeys"]>;
export type AuthContext = { Variables: { mcp: Principal; web: Owner; admin: AdminActor } };

export function requireServiceIdentity<I extends keyof ServiceKeys>(
  expectedIss: I,
  publicKeys: ServiceKeys,
): MiddlewareHandler<AuthContext> {
  return async (c, next) => {
    const token = /^Bearer ([^\s]+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
    if (!token) throw new BrokerError("unauthorized", "Se requiere un token de servicio.");
    try {
      const identity = await verifyServiceToken(token, { publicKeys, expectedIss });
      c.set(expectedIss, identity);
    } catch {
      throw new BrokerError("unauthorized", "El token de servicio no es válido.");
    }
    await next();
  };
}
