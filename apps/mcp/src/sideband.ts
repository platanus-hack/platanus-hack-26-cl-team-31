import { once } from "node:events";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentClient } from "@team-31/broker/client";
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

export async function startSideband(stdio: boolean, devAuth: boolean) {
  if (stdio && !devAuth) throw new Error("El modo stdio requiere MCP_DEV_AUTH=1.");

  const baseUrl = readEnv("BROKER_URL", httpUrl);
  const getServiceToken = createServiceTokenMinter(process.env.MCP_SERVICE_PRIVATE_KEY);
  const oauth = stdio ? null : readOAuthConfig(process.env);
  // Created after validating the configuration: emits service.started and the heartbeat.
  const telemetry = createMcpTelemetry(stdio);
  const messages = createMessageRuntime(telemetry);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void Promise.all([telemetry.shutdown(), messages?.close()]).finally(() => process.exit());
    });
  }
  const agent = createAgentClient({ baseUrl, getServiceToken, fetch: tracedFetch(telemetry) });

  if (!oauth) {
    const principal = {
      userId: readEnv("SIDEBAND_DEV_USER_ID", id),
      agentId: readEnv("SIDEBAND_DEV_AGENT_ID", id),
      scopes: [...Scope.options],
    };
    await agent.connect(principal);
    await createServer(principal, agent, telemetry, messages?.handleMessage).connect(new StdioServerTransport());
    console.error("[sideband-mcp] Listo en stdio.");
    return;
  }

  const server = createHttpServer({ ...oauth, devAuth }, agent, telemetry, messages?.handleMessage);
  const port = readEnv("MCP_PORT", z.string().regex(/^\d+$/).pipe(z.coerce.number<string>().int().min(1).max(65535)));
  server.listen(port, process.env.MCP_HOST || "127.0.0.1");
  try {
    await once(server, "listening");
  } catch (error) {
    telemetry.error("mcp.listen", error);
    await telemetry.shutdown();
    throw error;
  }
  console.error(`[sideband-mcp] Listo en puerto ${port}.`);
}
