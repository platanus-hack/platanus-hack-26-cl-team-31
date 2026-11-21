import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BrokerError } from "@team-31/broker-client";
import type { ErrorCode, Principal, Scope } from "@team-31/protocol";
import type { Telemetry } from "@team-31/telemetry";

export type ToolTelemetry = Pick<Telemetry, "span" | "emit" | "error" | "identify">;

export function toolError(code: ErrorCode, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { ok: false, error: { code, message } },
  };
}

type Outcome = "ok" | "error" | "denied";

/**
 * Runs a Sideband tool inside the span mcp.tool.call (tool and outcome, never args or result).
 * The span is the parent of the call to the broker, which continues the same trace.
 */
export async function runTool(
  telemetry: ToolTelemetry,
  principal: Principal,
  call: { tool: string; scope: Scope; requestId?: string },
  invoke: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  return telemetry.span("mcp.tool.call", {
    userId: principal.userId,
    agentId: principal.agentId,
    ...(call.requestId ? { requestId: call.requestId } : {}),
    attrs: { tool: call.tool },
  }, async (span) => {
    // The span status is "error" only for internal failures, not for domain errors (not_found…).
    const finish = (outcome: Outcome, result: CallToolResult, internal = false) => {
      span.set({ outcome });
      if (internal) span.setStatus("error");
      return result;
    };

    if (!principal.scopes.includes(call.scope)) {
      telemetry.emit("auth.scope.denied", { attrs: { scope: call.scope, operation: call.tool } });
      return finish("denied", toolError("forbidden", "Tu conexión no tiene permiso para esto; vuelve a autorizar en la App Sideband"));
    }

    try {
      const result = await invoke();
      if (typeof result.requestId === "string") telemetry.identify({ requestId: result.requestId });
      return finish("ok", { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    } catch (error) {
      if (error instanceof BrokerError && error.code !== "internal") {
        return finish(error.code === "forbidden" ? "denied" : "error", toolError(error.code, error.message));
      }
      span.setErrorId(telemetry.error(`mcp.tool.call ${call.tool}`, error));
      if (error instanceof BrokerError) return finish("error", toolError(error.code, error.message), true);
      return finish("error", toolError("internal", "No se pudo completar la operación."), true);
    }
  });
}
