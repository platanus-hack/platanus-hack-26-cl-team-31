import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BrokerError } from "@team-31/broker/client";
import type { ErrorCode, Principal, Scope } from "@team-31/protocol";

export function toolError(code: ErrorCode, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { ok: false, error: { code, message } },
  };
}

export async function runTool(
  principal: Principal,
  scope: Scope,
  invoke: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  if (!principal.scopes.includes(scope)) {
    return toolError("forbidden", "Tu conexión no tiene permiso para esto; vuelve a autorizar en la App Nexo");
  }

  try {
    const result = await invoke();
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    if (error instanceof BrokerError) return toolError(error.code, error.message);
    return toolError("internal", "No se pudo completar la operación.");
  }
}
