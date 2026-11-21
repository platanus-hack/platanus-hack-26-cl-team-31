#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the MCP protocol: log to stderr only.
  console.error("[team-31-mcp] server running on stdio");
}

main().catch((error) => {
  console.error("[team-31-mcp] fatal error:", error);
  process.exit(1);
});
