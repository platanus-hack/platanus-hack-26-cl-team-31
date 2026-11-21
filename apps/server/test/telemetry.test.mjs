import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createTelemetry, memorySink } from "@team-31/telemetry";
import { z } from "zod";
import { createCoordinationHandler } from "../dist/http.js";

const secret = "texto privado del grupo";
const tools = [
  { name: "echo_tool", description: "", inputSchema: {}, run: async (_db, _me, input) => z.object({ text: z.string() }).strict().parse(input) && { status: "available" } },
  { name: "deny_tool", description: "", inputSchema: {}, run: async () => ({ status: "not_shareable" }) },
  { name: "broken_tool", description: "", inputSchema: {}, run: async () => { throw new TypeError(secret); } },
];

// Fake pool: one valid token for "ana". The tool transactions are no-ops.
const pool = {
  async query(_sql, values) {
    return { rows: values?.[0] ? [{ id: "ana" }] : [] };
  },
  async connect() {
    return { query: async () => ({ rows: [] }), release() {} };
  },
};

async function start(t) {
  const sink = memorySink();
  const telemetry = createTelemetry({ service: "coordination", sink, heartbeatMs: 0, lifecycle: false });
  const server = createServer(createCoordinationHandler({ pool, tools, telemetry }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, token = "token", headers = {}) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { sink, call };
}

test("cada tool emite coordination.tool.call con su resultado y sin datos", async (t) => {
  const { sink, call } = await start(t);
  const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  const ok = await call("/tools/echo_tool", { text: secret }, "token", { traceparent });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("x-trace-id"), "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.equal((await call("/tools/deny_tool", {})).status, 200);
  assert.equal((await call("/tools/echo_tool", { other: 1 })).status, 400);
  const broken = await call("/tools/broken_tool", {});
  assert.equal(broken.status, 503);

  const calls = sink.find("coordination.tool.call");
  assert.deepEqual(calls.map((record) => [record.attrs.tool, record.attrs.outcome, record.userId]), [
    ["echo_tool", "ok", "ana"],
    ["deny_tool", "not_shareable", "ana"],
    ["echo_tool", "invalid_input", "ana"],
    ["broken_tool", "error", "ana"],
  ]);
  assert.equal(calls[0].traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  const errors = sink.find("error");
  assert.equal(errors.length, 1);
  assert.equal(broken.headers.get("x-error-id"), errors[0].errorId);
  const spans = sink.find("http.request");
  assert.deepEqual(spans.at(-1).attrs, { method: "POST", route: "/tools/:name", status: 503, bucket: "5xx" });
  assert.ok(!JSON.stringify(sink.records).includes(secret));
});

test("registra tokens rechazados sin el token", async (t) => {
  const { sink, call } = await start(t);
  assert.equal((await call("/tools", undefined, null)).status, 401);
  assert.equal((await call("/tools", undefined, "")).status, 401);
  assert.deepEqual(sink.find("auth.token.rejected").map((record) => record.attrs.reason), ["missing_token", "missing_token"]);
});
