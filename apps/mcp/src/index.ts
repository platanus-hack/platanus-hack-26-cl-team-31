#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

import { coordinationServer } from "./coordination.js";

async function main() {
  const { COORDINATION_API_URL: url, AGENT_TOKEN: token } = process.env;
  if (Boolean(url) !== Boolean(token)) throw new Error("Se requieren COORDINATION_API_URL y AGENT_TOKEN juntos");
  const server = url && token ? coordinationServer(url, token) : createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the MCP protocol: log to stderr only.
  console.error("[team-31-mcp] server running on stdio");
}

main().catch((error) => {
  console.error("[team-31-mcp] fatal error:", error);
  process.exit(1);
});
