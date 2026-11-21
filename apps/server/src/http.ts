import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Telemetry } from "@team-31/telemetry";
import type pg from "pg";
import { z } from "zod";
import { availabilityTools } from "./availability.js";
import { contactTools } from "./contacts.js";
import { meetingTools } from "./meetings.js";

const tools = [...availabilityTools, ...meetingTools, ...contactTools];
const maxInputBytes = 64 * 1024;
type Database = Pick<pg.Pool, "query" | "connect">;
type Tool = {
  name: string;
  description: string;
  inputSchema: unknown;
  run(db: pg.PoolClient, person: string, input: unknown): Promise<Record<string, unknown>>;
};

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(body);
}

async function readInput(request: IncomingMessage, telemetry: Telemetry) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxInputBytes) return { status: 413, code: "input_too_large" } as const;
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { status: 200, value } as const;
  } catch (error) {
    return { status: 400, code: "invalid_input", errorId: telemetry.error("coordination.input", error) } as const;
  }
}

async function runTool(pool: Database, telemetry: Telemetry, tool: Tool, person: string, input: unknown) {
  const client = await pool.connect();
  let discard = true;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    try {
      const result = await tool.run(client, person, input);
      await client.query("COMMIT");
      discard = false;
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
        discard = false;
      } catch (rollbackError) {
        telemetry.error("coordination.rollback", rollbackError);
      }
      throw error;
    }
  } finally {
    client.release(discard);
  }
}

export function createCoordinationHandler({ pool, tools: registeredTools = tools, telemetry }: {
  pool: Database; tools?: Tool[]; telemetry: Telemetry;
}) {
  const toolsByName = new Map(registeredTools.map((tool) => [tool.name, tool]));
  const catalog = registeredTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  async function serve(request: IncomingMessage, response: ServerResponse, route: string, tool: Tool | undefined) {
    if (route === "/health") {
      await pool.query("SELECT 1");
      return json(response, 200, { status: "ok" });
    }

    const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1];
    const hash = token ? createHash("sha256").update(token).digest("hex") : undefined;
    const person = hash ? (await pool.query<{ id: string }>("SELECT id FROM people WHERE token_hash=$1", [hash])).rows[0] : undefined;
    if (!person) {
      telemetry.emit("auth.token.rejected", { attrs: { issuer: "coordination", reason: token ? "unknown_token" : "missing_token" } });
      return json(response, 401, { error: "unauthorized" });
    }
    telemetry.identify({ userId: person.id });
    telemetry.emit("auth.token.verified", { attrs: { issuer: "coordination" } });
    if (route === "/tools") return json(response, 200, { tools: catalog });
    if (!tool) return json(response, 404, { error: "unknown_tool" });

    const input = await readInput(request, telemetry);
    if (input.status !== 200) {
      if (input.errorId) response.setHeader("X-Error-Id", input.errorId);
      return json(response, input.status, { error: input.code });
    }
    const result = await telemetry.span("coordination.tool.call", { attrs: { tool: tool.name } }, async (span) => {
      try {
        const result = await runTool(pool, telemetry, tool, person.id, input.value);
        span.set({ outcome: "status" in result && result.status === "not_shareable" ? "not_shareable" : "ok" });
        return result;
      } catch (error) {
        span.set({ outcome: error instanceof z.ZodError ? "invalid_input" : "error" });
        throw error;
      }
    }).catch((error: unknown) => {
      if (!(error instanceof z.ZodError)) throw error;
      response.setHeader("X-Error-Id", telemetry.error("coordination.tool.input", error));
      return null;
    });
    if (result === null) return json(response, 400, { error: "invalid_input" });
    json(response, 200, result);
  }

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "UNKNOWN";
    const name = method === "POST" ? /^\/tools\/([a-z_]+)$/.exec(request.url ?? "")?.[1] : undefined;
    const tool = name ? toolsByName.get(name) : undefined;
    const route = method === "GET" && (request.url === "/health" || request.url === "/tools")
      ? request.url
      : tool ? "/tools/:name" : "unmatched";
    const traceparent = request.headers.traceparent;
    await telemetry.span("http.request", {
      traceparent: typeof traceparent === "string" ? traceparent : null,
      attrs: { method, route },
    }, async (span) => {
      try {
        response.setHeader("X-Trace-Id", span.traceId);
        await serve(request, response, route, tool);
      } catch (error) {
        const errorId = telemetry.error(`${method} ${route}`, error);
        span.setErrorId(errorId);
        span.setStatus("error");
        span.setLevel("error");
        if (response.headersSent || response.destroyed) {
          response.destroy();
        } else {
          response.setHeader("X-Error-Id", errorId);
          json(response, 503, { error: "unavailable" });
        }
      } finally {
        const status = response.statusCode;
        span.set({ status, bucket: `${Math.floor(status / 100)}xx` });
      }
    });
  };
}
