import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { notImplemented } from "./not-implemented.js";

/**
 * `send` tool — scaffold only.
 * TODO: define the real input schema and plug in the actual send logic.
 */
export function registerSendTool(server: McpServer): void {
  server.registerTool(
    "send",
    {
      title: "Send",
      description: "Sends a message. (Not implemented yet)",
      inputSchema: {
        payload: z.string().describe("Content to send (placeholder schema)"),
      },
    },
    async (_args) => notImplemented("send"),
  );
}
