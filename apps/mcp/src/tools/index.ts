import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEchoTool } from "./echo.js";
import { registerReceiveTool } from "./receive.js";
import { registerSendTool } from "./send.js";

export function registerTools(server: McpServer): void {
  registerEchoTool(server);
  registerSendTool(server);
  registerReceiveTool(server);
}
