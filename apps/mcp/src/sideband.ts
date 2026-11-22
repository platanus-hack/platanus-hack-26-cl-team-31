import { once } from "node:events";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentClient } from "@team-31/broker-client";
import { createMessageRuntime } from "@team-31/message-flow/runtime";
import { Scope } from "@team-31/protocol";
import { tracedFetch } from "@team-31/telemetry";
import { z } from "zod";
import { createHttpServer } from "./http.js";
import { readOAuthConfig } from "./oauth-config.js";
import { createServer } from "./server.js";
import { createServiceTokenMinter } from "./service-token.js";
import { createMcpTelemetry } from "./telemetry.js";

const httpUrl = z.url({ protocol: /^https?$/ });
const id = z.string().regex(/^[^:\s]+$/);

function readEnv<T extends z.ZodType>(name: string, schema: T): z.output<T> {
  const parsed = schema.safeParse(process.env[name]);
  if (!parsed.success) throw new Error(`Revisa el valor de ${name}.`);
  return parsed.data;
}

function readTransport(stdio: boolean, devAuth: boolean) {
  if (stdio) {
    return {
      kind: "stdio" as const,
      principal: {
        userId: readEnv("SIDEBAND_DEV_USER_ID", id),
        agentId: readEnv("SIDEBAND_DEV_AGENT_ID", id),
        scopes: [...Scope.options],
      },
    };
  }
  return {
    kind: "http" as const,
    oauth: { ...readOAuthConfig(process.env), devAuth },
    port: readEnv("MCP_PORT", z.string().regex(/^\d+$/).pipe(z.coerce.number<string>().int().min(1).max(65535))),
    host: process.env.MCP_HOST || "127.0.0.1",
  };
}

export async function startSideband(stdio: boolean, devAuth: boolean) {
  if (stdio && !devAuth) throw new Error("El modo stdio requiere MCP_DEV_AUTH=1.");

  const baseUrl = readEnv("BROKER_URL", httpUrl);
  const getServiceToken = createServiceTokenMinter(process.env.MCP_SERVICE_PRIVATE_KEY);
  const transport = readTransport(stdio, devAuth);
  const telemetry = createMcpTelemetry(stdio);
  let messages: ReturnType<typeof createMessageRuntime>;
  let stream: StdioServerTransport | undefined;

  async function shutdown() {
    const reportCloseError = (error: unknown) => telemetry.error("mcp.close", error);
    await stream?.close().catch(reportCloseError);
    await messages?.close().catch(reportCloseError);
    await telemetry.shutdown();
  }

  let operation = "mcp.start";
  try {
    messages = createMessageRuntime(telemetry);
    const agent = createAgentClient({ baseUrl, getServiceToken, fetch: tracedFetch(telemetry) });
    if (transport.kind === "stdio") {
      operation = "mcp.connect";
      await agent.connect(transport.principal);
      const server = createServer(transport.principal, agent, telemetry, messages?.handleMessage);
      stream = new StdioServerTransport();
      await server.connect(stream);
    } else {
      const server = createHttpServer(transport.oauth, agent, telemetry, messages?.handleMessage);
      operation = "mcp.listen";
      server.listen(transport.port, transport.host);
      await once(server, "listening");
    }
  } catch (error) {
    telemetry.error(operation, error);
    await shutdown();
    throw error;
  }

  function stop() {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    void shutdown().finally(() => process.exit());
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.error(transport.kind === "stdio" ? "[sideband-mcp] Listo en stdio." : `[sideband-mcp] Listo en puerto ${transport.port}.`);
}
