import { once } from "node:events";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentClient } from "@team-31/broker/client";
import { Scope } from "@team-31/protocol";
import { tracedFetch } from "@team-31/telemetry";
import { z } from "zod";
import { createHttpServer } from "./http.js";
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

export async function startNexo(stdio: boolean, devAuth: boolean) {
  if (stdio && !devAuth) throw new Error("El modo stdio requiere MCP_DEV_AUTH=1.");

  const baseUrl = readEnv("BROKER_URL", httpUrl);
  const getServiceToken = createServiceTokenMinter(process.env.MCP_SERVICE_PRIVATE_KEY);
  // Created after validating the configuration: emits service.started and the heartbeat.
  const telemetry = createMcpTelemetry(stdio);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void telemetry.shutdown().finally(() => process.exit());
    });
  }
  const agent = createAgentClient({ baseUrl, getServiceToken, fetch: tracedFetch(telemetry) });

  if (stdio) {
    const principal = {
      userId: readEnv("NEXO_DEV_USER_ID", id),
      agentId: readEnv("NEXO_DEV_AGENT_ID", id),
      scopes: [...Scope.options],
    };
    await createServer(principal, agent, telemetry).connect(new StdioServerTransport());
    console.error("[nexo-mcp] Listo en stdio.");
    return;
  }

  const resourceUrl = readEnv("MCP_RESOURCE_URL", httpUrl).trim();
  const resource = new URL(resourceUrl);
  if (resource.pathname !== "/mcp" || resource.search || resource.hash || resource.username || resource.password) {
    throw new Error("MCP_RESOURCE_URL debe apuntar a /mcp.");
  }

  const server = createHttpServer({
    issuer: readEnv("AUTH_ISSUER", httpUrl),
    jwksUrl: readEnv("AUTH_JWKS_URL", httpUrl),
    audience: resourceUrl,
    devAuth,
  }, agent, telemetry);
  const port = readEnv("MCP_PORT", z.string().regex(/^\d+$/).pipe(z.coerce.number<string>().int().min(1).max(65535)));
  server.listen(port, process.env.MCP_HOST || "127.0.0.1");
  await once(server, "listening");
  console.error(`[nexo-mcp] Listo en puerto ${port}.`);
}
