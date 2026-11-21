import { verifyServiceToken } from "@team-31/auth/service";
import { BrokerError } from "@team-31/broker";
import type { AdminActor, Owner, Principal } from "@team-31/protocol";
import type { Telemetry } from "@team-31/telemetry";
import type { MiddlewareHandler } from "hono";

export type ServiceKeys = NonNullable<Parameters<typeof verifyServiceToken>[1]["publicKeys"]>;
export type AuthContext = { Variables: { mcp: Principal; web: Owner; admin: AdminActor } };

// jose reports a stable code (ERR_JWT_EXPIRED, ERR_JWS_SIGNATURE_VERIFICATION_FAILED…); never the message.
function rejectionReason(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^ERR_[A-Z_]{1,64}$/.test(code) ? code : "invalid_claims";
}

export function requireServiceIdentity<I extends keyof ServiceKeys>(
  expectedIss: I,
  publicKeys: ServiceKeys,
  telemetry: Pick<Telemetry, "emit" | "identify">,
): MiddlewareHandler<AuthContext> {
  return async (c, next) => {
    const token = /^Bearer ([^\s]+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
    if (!token) {
      telemetry.emit("auth.service_jwt.rejected", { attrs: { expectedIss, reason: "missing_token" } });
      throw new BrokerError("unauthorized", "Se requiere un token de servicio.");
    }
    try {
      const identity = await verifyServiceToken(token, { publicKeys, expectedIss });
      c.set(expectedIss, identity);
      // user_id in ops.events is always a Nexo user: the admin operator stays out of it.
      if ("userId" in identity) {
        telemetry.identify({ userId: identity.userId, ...("agentId" in identity ? { agentId: identity.agentId } : {}) });
      }
    } catch (error) {
      telemetry.emit("auth.service_jwt.rejected", { attrs: { expectedIss, reason: rejectionReason(error) } });
      throw new BrokerError("unauthorized", "El token de servicio no es válido.");
    }
    await next();
  };
}
