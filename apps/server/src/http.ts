import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Telemetry } from "@team-31/telemetry";
import type { PoolClient } from "pg";
import { z } from "zod";

export type CoordinationTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  run(db: PoolClient, me: string, input: unknown): Promise<object>;
};

export type CoordinationPool = {
  query<R extends object>(sql: string, values?: unknown[]): Promise<{ rows: R[] }>;
  connect(): Promise<Pick<PoolClient, "query" | "release">>;
};

function json(response: ServerResponse, code: number, value: unknown) {
  response.writeHead(code, {"content-type": "application/json", "cache-control": "no-store"});
  response.end(JSON.stringify(value));
}

// Route pattern for http.request: the tool name is a fixed identifier, never user input.
function routeOf(method: string | undefined, url: string | undefined, tools: Map<string, CoordinationTool>): string {
  if (url === "/health") return "/health";
  if (url === "/tools") return "/tools";
  const name = /^\/tools\/([a-z_]+)$/.exec(url ?? "")?.[1];
  return method === "POST" && name && tools.has(name) ? "/tools/:name" : "unmatched";
}

export function createCoordinationHandler({ pool, tools, telemetry }: {
  pool: CoordinationPool;
  tools: CoordinationTool[];
  telemetry: Telemetry;
}) {
  const byName = new Map(tools.map(tool => [tool.name, tool]));

  async function serve(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "GET" && request.url === "/health") {
      await pool.query("SELECT 1");
      return json(response, 200, {status: "ok"});
    }
    const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1];
    if (!token) {
      telemetry.emit("auth.token.rejected", {attrs: {issuer: "coordination", reason: "missing_token"}});
      return json(response, 401, {error: "unauthorized"});
    }
    const hash = createHash("sha256").update(token).digest("hex");
    const person = await pool.query<{id:string}>("SELECT id FROM people WHERE token_hash=$1", [hash]);
    const me = person.rows[0]?.id;
    if (!me) {
      telemetry.emit("auth.token.rejected", {attrs: {issuer: "coordination", reason: "unknown_token"}});
      return json(response, 401, {error: "unauthorized"});
    }
    telemetry.identify({userId: me});

    if (request.method === "GET" && request.url === "/tools") {
      return json(response, 200, {tools: tools.map(({name, description, inputSchema}) => ({name, description, inputSchema}))});
    }
    const name = /^\/tools\/([a-z_]+)$/.exec(request.url ?? "")?.[1];
    const tool = byName.get(name ?? "");
    if (request.method !== "POST" || !tool) return json(response, 404, {error: "unknown_tool"});
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 64 * 1024) return json(response, 413, {error: "input_too_large"});
      chunks.push(chunk);
    }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return json(response, 400, {error: "invalid_input"}); }

    // coordination.tool.call: tool and outcome only, never the input or the result.
    return telemetry.span("coordination.tool.call", {attrs: {tool: tool.name}}, async (span) => {
      const db = await pool.connect();
      try {
        await db.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        const result = await tool.run(db as PoolClient, me, input);
        await db.query("COMMIT");
        const status = (result as {status?: unknown}).status;
        span.set({outcome: status === "not_shareable" ? "not_shareable" : "ok"});
        json(response, 200, result);
      } catch (error) {
        await db.query("ROLLBACK");
        if (error instanceof z.ZodError) {
          span.set({outcome: "invalid_input"});
          return json(response, 400, {error: "invalid_input"});
        }
        span.set({outcome: "error"});
        throw error;
      } finally { db.release(); }
    });
  }

  return function handle(request: IncomingMessage, response: ServerResponse) {
    const route = routeOf(request.method, request.url, byName);
    const fail = (error: unknown) => {
      const errorId = telemetry.error(`${request.method ?? "UNKNOWN"} ${route}`, error);
      if (!response.headersSent) {
        response.setHeader("X-Error-Id", errorId);
        json(response, 503, {error: "unavailable"});
      } else if (!response.writableEnded) {
        response.end();
      }
      return errorId;
    };
    if (route === "/health") {
      void serve(request, response).catch(fail);
      return;
    }
    void telemetry.span("http.request", {
      traceparent: typeof request.headers.traceparent === "string" ? request.headers.traceparent : null,
      attrs: {method: request.method ?? "UNKNOWN", route},
    }, async (span) => {
      response.setHeader("X-Trace-Id", span.traceId);
      try {
        await serve(request, response);
      } catch (error) {
        span.setErrorId(fail(error));
      }
      const status = response.statusCode;
      span.set({status, bucket: `${Math.floor(status / 100)}xx`});
      if (status >= 500) {
        span.setStatus("error");
        span.setLevel("error");
      }
    });
  };
}
