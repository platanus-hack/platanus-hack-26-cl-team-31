import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { BrokerError, type AgentPort } from "@team-31/broker/client";
import { WAKE_EVENT, type Principal, type Waker } from "@team-31/protocol";
import { z } from "zod";

const eventDefinition = {
  name: WAKE_EVENT,
  description: "Llegó una solicitud a tu bandeja. Con su requestId, busca la solicitud en nexo_inbox y respóndela con nexo_reply.",
  delivery: ["webhook"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  payloadSchema: {
    type: "object",
    properties: { requestId: { type: "string" } },
    required: ["requestId"],
    additionalProperties: false,
  },
};

const eventTarget = z.object({
  name: z.literal(WAKE_EVENT),
  arguments: z.strictObject({}).default({}),
  delivery: z.object({ mode: z.literal("webhook"), url: z.url({ protocol: /^https?$/ }) }),
});
const subscribe = eventTarget.extend({
  delivery: eventTarget.shape.delivery.extend({
    secret: z.string().refine((secret) => {
      const match = /^whsec_([A-Za-z0-9+/_-]{32,86})(={0,2})$/.exec(secret);
      if (!match?.[1]) return false;

      const decoded = Buffer.from(match[1], "base64");
      if (decoded.length < 24 || decoded.length > 64) return false;
      const encoded = decoded.toString("base64");
      const normalized = match[1].replaceAll("-", "+").replaceAll("_", "/");
      return (normalized + match[2] === encoded) ||
        (match[2] === "" && normalized === encoded.replace(/=+$/, ""));
    }),
  }),
});

const unsubscribe = z.union([eventTarget, z.object({ id: z.string().regex(/^sub_[0-9a-f]{16}$/) })]);
const retentionMs = 7 * 24 * 60 * 60 * 1000;
type CallbackFailure = Extract<Awaited<ReturnType<Waker["verifyCallback"]>>, { ok: false }>["reason"];
const callbackFailures: ReadonlySet<string> = new Set<CallbackFailure>([
  "challenge_failed", "timeout", "https_required", "blocked_address",
]);

function subscriptionId(principal: Principal, target: z.output<typeof eventTarget>) {
  // No filters are supported, so the only canonical arguments object is {}.
  const key = [principal.userId, principal.agentId, target.delivery.url, target.name, JSON.stringify(target.arguments)].join("|");
  return `sub_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

export function registerEvents(server: McpServer, principal: Principal, agent: AgentPort) {
  // MCP Events extends the capabilities defined by the SDK.
  const capabilities = { tools: {}, events: {} };
  server.server.registerCapabilities(capabilities);
  server.server.setRequestHandler(
    z.object({ method: z.literal("events/list"), params: z.unknown().optional() }),
    async () => ({ events: [eventDefinition] }),
  );

  server.server.setRequestHandler(
    z.object({ method: z.literal("events/subscribe"), params: z.unknown() }),
    async ({ params }) => {
      const parsed = subscribe.safeParse(params);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, "Indica el evento, la URL del webhook y un secreto whsec_ de 24 a 64 bytes en base64.");
      }

      const target = parsed.data;
      const id = subscriptionId(principal, target);
      const refreshBefore = new Date(Date.now() + retentionMs).toISOString();
      try {
        await agent.connectWake(principal, {
          kind: "mcp_events",
          callbackUrl: target.delivery.url,
          secret: target.delivery.secret,
          subscriptionId: id,
          refreshBefore,
        });
      } catch (error) {
        if (error instanceof BrokerError && error.code === "invalid_input" && callbackFailures.has(error.message)) {
          throw new McpError(-32015, "CallbackEndpointError", { reason: error.message });
        }
        throw eventError(error);
      }
      return { id, refreshBefore, cursor: null, truncated: false };
    },
  );

  server.server.setRequestHandler(
    z.object({ method: z.literal("events/unsubscribe"), params: z.unknown() }),
    async ({ params }) => {
      const parsed = unsubscribe.safeParse(params);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, "Indica la suscripción o el evento con su URL de webhook.");
      }

      const target = parsed.data;
      try {
        await agent.disconnectWake(principal, "id" in target ? target.id : subscriptionId(principal, target));
      } catch (error) {
        if (!(error instanceof BrokerError && error.code === "not_found")) throw eventError(error);
      }
      return {};
    },
  );
}

function eventError(error: unknown) {
  if (error instanceof BrokerError && error.code !== "internal") {
    const code = error.code === "invalid_input" ? ErrorCode.InvalidParams : -32000;
    return new McpError(code, error.message, { code: error.code });
  }
  return new McpError(ErrorCode.InternalError, "No se pudo gestionar la suscripción.");
}
