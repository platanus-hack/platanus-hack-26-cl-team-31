#!/usr/bin/env node
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

class CoordinationHttpError extends Error {
  constructor(status: number, readonly errorId?: string) {
    super(`Coordinación HTTP ${status}`);
  }
}

// One stdio process per principal. Tool arguments cannot select a credential or endpoint.
function coordinationServer(base: string, token: string) {
  const toolResult = z.record(z.string(), z.unknown());
  const server = new Server({name: "sideband-coordination", version: "0.1.0"}, {capabilities: {tools: {}}});
  async function call(path: string, args?: unknown) {
    const response = await fetch(new URL(path, base), {
      method: args === undefined ? "GET" : "POST",
      headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
      body: args === undefined ? undefined : JSON.stringify(args),
      redirect: "error",
    });
    if (!response.ok) {
      const id = z.uuid().safeParse(response.headers.get("X-Error-Id"));
      throw new CoordinationHttpError(response.status, id.success ? id.data : undefined);
    }
    return response.json();
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ListToolsResultSchema.parse(await call("/tools")));
  server.setRequestHandler(CallToolRequestSchema, async ({params}) => {
    try {
      const result = toolResult.parse(await call(`/tools/${encodeURIComponent(params.name)}`, params.arguments ?? {}));
      return {content: [{type:"text", text:JSON.stringify(result)}], structuredContent: result};
    } catch (error) {
      const message = error instanceof Error ? error.message : "Servicio no disponible";
      const errorId = error instanceof CoordinationHttpError ? error.errorId : undefined;
      return {
        isError: true,
        content: [{ type: "text", text: errorId ? `${message} (ID: ${errorId})` : message }],
        ...(errorId && { structuredContent: { error: { message, errorId } } }),
      };
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
