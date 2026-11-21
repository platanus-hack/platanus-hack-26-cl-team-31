#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

// One stdio process per principal. Tool arguments cannot select a credential or endpoint.
function coordinationServer(base: string, token: string) {
  const server = new Server({name: "sideband-coordination", version: "0.1.0"}, {capabilities: {tools: {}}});
  async function call(path: string, args?: unknown) {
    const response = await fetch(new URL(path, base), {
      method: args === undefined ? "GET" : "POST",
      headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
      body: args === undefined ? undefined : JSON.stringify(args),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Coordinación HTTP ${response.status}`);
    return response.json();
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ListToolsResultSchema.parse(await call("/tools")));
  server.setRequestHandler(CallToolRequestSchema, async ({params}) => {
    try {
      const result = await call(`/tools/${encodeURIComponent(params.name)}`, params.arguments ?? {});
      return {content: [{type:"text", text:JSON.stringify(result)}], structuredContent: result};
    } catch (error) {
      return {isError:true, content:[{type:"text", text:error instanceof Error ? error.message : "Servicio no disponible"}]};
    }
  });
  return server;
}

const { COORDINATION_API_URL: url, AGENT_TOKEN: token } = process.env;
if (!url || !token) {
  console.error("[team-31-coordination] Se requieren COORDINATION_API_URL y AGENT_TOKEN.");
  process.exitCode = 1;
} else {
  await coordinationServer(url, token).connect(new StdioServerTransport());
  console.error("[team-31-coordination] Coordinación lista en stdio.");
}
