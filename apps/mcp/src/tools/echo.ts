import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Sanity-check tool: returns the input as-is. Useful to verify the client wiring. */
export function registerEchoTool(server: McpServer): void {
  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Returns the given message unchanged. Use it to check the MCP connection.",
      inputSchema: {
        message: z.string().describe("Text to echo back"),
      },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    }),
  );
}
