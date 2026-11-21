import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { createMcpGuard } from "@team-31/auth/resource";
import { acceptsMcpOrigin } from "@team-31/auth";
import { BrokerError, type AgentPort } from "@team-31/broker/client";
import { Scope, type Principal } from "@team-31/protocol";
import { silentTelemetry, type Telemetry } from "@team-31/telemetry";
import { createServer } from "./server.js";

const mcpPath = "/mcp";
const metadataPath = "/.well-known/oauth-protected-resource";

// Route pattern for http.request: never the raw path or its query.
function routeOf(path: string | undefined): string {
  if (path === mcpPath || path === "/healthz") return path;
  if (path === metadataPath || path === metadataPath + mcpPath) return path;
  return "unmatched";
}

// Code of a rejected access token. The token and the verifier's message are never recorded.
function rejectionReason(authorization: string | undefined, status: number): string {
  if (!authorization) return "missing_token";
  if (!/^(Bearer|DPoP) \S+$/i.test(authorization)) return "malformed_header";
  return status === 401 ? "invalid_token" : `http_${status}`;
}

export function createHttpServer(
  options: Parameters<typeof createMcpGuard>[0],
  agent: AgentPort,
  telemetry: Telemetry = silentTelemetry("mcp"),
) {
  const guard = createMcpGuard(options);
  const resource = new URL(options.audience);
  const metadata = {
    resource: options.audience,
    authorization_servers: [options.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [...Scope.options, "offline_access"],
  };

  return createNodeServer((req, res) => {
    const path = req.url?.split("?", 1)[0];
    if (path === mcpPath) res.setHeader("Cache-Control", "no-store");
    const route = routeOf(path);
    const run = route === "/healthz" ? () => handle(req, res, path) : () => observed(req, res, path, route);
    void run().catch((error: unknown) => failed(req, res, route, error));
  });

  // Span http.request that continues the caller's traceparent and answers X-Trace-Id.
  function observed(req: IncomingMessage, res: ServerResponse, path: string | undefined, route: string) {
    return telemetry.span("http.request", {
      traceparent: typeof req.headers.traceparent === "string" ? req.headers.traceparent : null,
      attrs: { method: req.method ?? "UNKNOWN", route },
    }, async (span) => {
      if (!res.headersSent) res.setHeader("X-Trace-Id", span.traceId);
      try {
        await handle(req, res, path);
      } catch (error) {
        span.setErrorId(failed(req, res, route, error));
      }
      const status = res.statusCode;
      span.set({ status, bucket: `${Math.floor(status / 100)}xx` });
      if (status >= 500) {
        span.setStatus("error");
        span.setLevel("error");
      }
    });
  }

  function failed(req: IncomingMessage, res: ServerResponse, route: string, error: unknown): string {
    const errorId = telemetry.error(`${req.method ?? "UNKNOWN"} ${route}`, error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json", "X-Error-Id": errorId }).end(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: ErrorCode.InternalError, message: "No se pudo procesar la solicitud." },
      }));
    } else if (!res.writableEnded) {
      res.end();
    }
    return errorId;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string | undefined) {
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
    if (!acceptsMcpOrigin(req.headers.origin, resource.origin)) {
      res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({
        jsonrpc: "2.0", id: null, error: { code: -32000, message: "Origen no permitido." },
      }));
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

    const authorization = req.headers.authorization;
    const devToken = options.devAuth === true && /^Bearer dev:/i.test(authorization ?? "");
    const issuer = devToken ? "dev" : options.issuer;
    if (!principal) {
      telemetry.emit("auth.token.rejected", { attrs: { issuer, reason: rejectionReason(authorization, authResult.status) } });
      res.writeHead(authResult.status, Object.fromEntries(authResult.headers)).end(await authResult.text());
      return;
    }
    telemetry.identify({ userId: principal.userId, agentId: principal.agentId });
    telemetry.emit("auth.token.verified", { attrs: { issuer, reason: devToken ? "dev_token" : "jwt" } });
    if (res.destroyed) return;

    try {
      await agent.connect(principal);
    } catch (error) {
      if (!(error instanceof BrokerError) || !["conflict", "not_found", "rate_limited"].includes(error.code)) throw error;
      const status = error.code === "conflict" ? 409 : error.code === "rate_limited" ? 429 : 403;
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({
        jsonrpc: "2.0", id: null, error: { code: -32000, message: error.message },
      }));
      return;
    }
    const server = createServer(principal, agent, telemetry);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once("close", () => {
      void server.close().catch((error: unknown) => telemetry.error("mcp.close", error));
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }
}
