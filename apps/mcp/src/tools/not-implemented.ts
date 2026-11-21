import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function notImplemented(tool: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Tool "${tool}" is not implemented yet.` }],
  };
}
