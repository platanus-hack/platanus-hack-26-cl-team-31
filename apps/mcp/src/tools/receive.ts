import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { notImplemented } from "./not-implemented.js";

/**
 * `receive` tool — scaffold only.
 * TODO: define the real input schema and plug in the actual receive logic.
 */
export function registerReceiveTool(server: McpServer): void {
  server.registerTool(
    "receive",
    {
      title: "Receive",
      description: "Receives pending messages. (Not implemented yet)",
      inputSchema: {},
    },
    async () => notImplemented("receive"),
  );
}
