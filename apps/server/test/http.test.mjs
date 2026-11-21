import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createTelemetry, memorySink } from "@team-31/telemetry";
import { createCoordinationHandler } from "../dist/http.js";

async function setup(t, { rows = [{ address: "bob" }], queryError, rollbackError } = {}) {
  const statements = [];
  const released = [];
  let connections = 0;
  const pool = {
    async query(sql) {
      assert.match(sql, /FROM people WHERE token_hash/);
      return { rows: [{ id: "ana" }] };
    },
    async connect() {
      connections++;
      return {
        async query(sql) {
          const command = sql.split(" ")[0];
          statements.push(command);
          if (command === "SELECT" && queryError) throw queryError;
          if (command === "ROLLBACK" && rollbackError) throw rollbackError;
          return { rows };
        },
        release(discard) { released.push(discard); },
      };
    },
  };
  const sink = memorySink();
  const telemetry = createTelemetry({ service: "coordination", sink, lifecycle: false });
  const server = createServer(createCoordinationHandler({ pool, telemetry }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return {
    call: (body) => fetch(`http://127.0.0.1:${port}/tools/list_contacts`, {
      method: "POST", body, headers: { Authorization: "Bearer local-test" },
    }),
    connections: () => connections,
    statements,
    released,
    sink,
  };
}

test("commit and release precede the tool response", async (t) => {
  const { call, statements, released, sink } = await setup(t);
  const response = await call("{}");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { contacts: [{ address: "bob" }] });
  assert.deepEqual(statements, ["BEGIN", "SELECT", "COMMIT"]);
  assert.deepEqual(released, [false]);
  assert.equal(sink.find("http.request")[0].traceId, response.headers.get("X-Trace-Id"));
});

test("malformed JSON returns an error ID before checking out a transaction client", async (t) => {
  const { call, connections, sink } = await setup(t);
  const response = await call("{");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_input" });
  assert.equal(response.headers.get("X-Error-Id"), sink.find("error")[0].errorId);
  assert.equal(connections(), 0);
});

test("schema validation rolls back and responds with 400", async (t) => {
  const { call, statements, released } = await setup(t);
  const response = await call('{"unexpected":true}');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_input" });
  assert.deepEqual(statements, ["BEGIN", "ROLLBACK"]);
  assert.deepEqual(released, [false]);
});

test("an error serializing a committed result does not roll back", async (t) => {
  const contact = {};
  contact.address = contact;
  const { call, statements, released } = await setup(t, { rows: [contact] });
  const response = await call("{}");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
  assert.deepEqual(statements, ["BEGIN", "SELECT", "COMMIT"]);
  assert.deepEqual(released, [false]);
});

test("a rollback failure discards the client and preserves the primary error ID", async (t) => {
  const queryError = Object.assign(new Error("private query detail"), { code: "23505" });
  const rollbackError = Object.assign(new Error("private connection detail"), { code: "08006" });
  const { call, statements, released, sink } = await setup(t, { queryError, rollbackError });
  const response = await call("{}");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
  assert.deepEqual(statements, ["BEGIN", "SELECT", "ROLLBACK"]);
  assert.deepEqual(released, [true]);
  const [rollback, primary] = sink.find("error");
  assert.equal(rollback.attrs.operation, "coordination.rollback");
  assert.equal(rollback.attrs.code, "08006");
  assert.equal(primary.attrs.code, "23505");
  assert.equal(response.headers.get("X-Error-Id"), primary.errorId);
  assert.ok(!JSON.stringify(sink.records).includes("private"));
});
