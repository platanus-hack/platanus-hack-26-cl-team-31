import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { createMcpGuard } from "@team-31/auth/resource";
import type { AgentPort } from "@team-31/broker/client";
import { Scope, type Principal } from "@team-31/protocol";
import { createServer } from "./server.js";

const mcpPath = "/mcp";
const metadataPath = "/.well-known/oauth-protected-resource";

export function createHttpServer(options: Parameters<typeof createMcpGuard>[0], agent: AgentPort) {
  const guard = createMcpGuard(options);
  const resource = new URL(options.audience);
  const metadata = {
    resource: options.audience,
    authorization_servers: [options.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [...Scope.options, "offline_access"],
  };

  return createNodeServer((req, res) => {
    void handle(req, res).catch(() => {
      console.error("[nexo-mcp] Error al procesar una solicitud HTTP.");
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: ErrorCode.InternalError, message: "No se pudo procesar la solicitud." },
        }));
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = req.url?.split("?", 1)[0];
    if (req.method === "GET") {
      if (path === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
        return;
      }

      if (path === metadataPath || path === metadataPath + mcpPath) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(metadata));
        return;
      }
    }

    if (path !== mcpPath) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }

    // The guard only reads the method, resource URL and headers. Keep the body
    // on the native request for the SDK to read and validate after authentication.
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else for (const item of value ?? []) headers.append(name, item);
    }
    const request = new Request(resource.href, { method: "POST", headers });
    let principal: Principal | undefined;
    const authResult = await guard(request, (identity) => {
      principal = identity;
      return new Response(null, { status: 204 });
    });

    if (!principal) {
      res.writeHead(authResult.status, Object.fromEntries(authResult.headers)).end(await authResult.text());
      return;
    }
    if (res.destroyed) return;

    const server = createServer(principal, agent);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once("close", () => {
      void server.close().catch(() => console.error("[nexo-mcp] Error al cerrar la conexión MCP."));
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }
}
