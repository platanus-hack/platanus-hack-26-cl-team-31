import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pg from "pg";
import { z } from "zod";
import { availabilityTools } from "./availability.js";
import { contactTools } from "./contacts.js";
import { meetingTools } from "./meetings.js";

const tools = [...availabilityTools, ...meetingTools, ...contactTools];
const byName = new Map(tools.map(tool => [tool.name, tool]));
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL requerida");
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});

function json(response: ServerResponse, code: number, value: unknown) {
  response.writeHead(code, {"content-type": "application/json", "cache-control": "no-store"});
  response.end(JSON.stringify(value));
}

async function serve(request: IncomingMessage, response: ServerResponse) {
  if (request.method === "GET" && request.url === "/health") {
    await pool.query("SELECT 1");
    return json(response, 200, {status: "ok"});
  }
  const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1];
  if (!token) return json(response, 401, {error: "unauthorized"});
  const hash = createHash("sha256").update(token).digest("hex");
  const person = await pool.query<{id:string}>("SELECT id FROM people WHERE token_hash=$1", [hash]);
  const me = person.rows[0]?.id;
  if (!me) return json(response, 401, {error: "unauthorized"});

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

  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const result = await tool.run(db, me, input);
    await db.query("COMMIT");
    json(response, 200, result);
  } catch (error) {
    await db.query("ROLLBACK");
    if (error instanceof z.ZodError) return json(response, 400, {error: "invalid_input"});
    throw error;
  } finally { db.release(); }
}

const server = createServer((request, response) => {
  serve(request, response).catch(error => {
    console.error("Coordination request failed", error instanceof Error ? error.name : "error");
    json(response, 503, {error: "unavailable"});
  });
});
const port = Number(process.env.COORDINATION_PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("COORDINATION_PORT requerido");
server.listen(port, process.env.COORDINATION_HOST ?? "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") {
    console.log("Coordinación lista en puerto", address.port);
  }
});
