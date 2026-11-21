import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Guardrails de la API HTTP de coordinación, probados contra el servidor compilado real.
const tokens = { ana: "token-ana", bob: "token-bob", eva: "token-eva" };
const slot = "2026-11-28T19:00:00Z";
const hash = token => createHash("sha256").update(token).digest("hex");

async function startServer(t) {
  assert.ok(process.env.TEST_DATABASE_URL, "Run pnpm bootstrap to provision TEST_DATABASE_URL");
  const url = new URL(process.env.TEST_DATABASE_URL);
  const schema = "http_" + randomUUID().replaceAll("-", "");
  url.searchParams.set("options", `-c search_path=${schema}`);
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  await db.query(`CREATE SCHEMA ${schema}`);
  for (const file of ["01-core.sql", "02-meetings.sql"]) {
    await db.query(await readFile(new URL(`../sql/${file}`, import.meta.url), "utf8"));
  }
  await db.query("INSERT INTO people VALUES ('ana',$1),('bob',$2),('eva',$3)",
    [hash(tokens.ana), hash(tokens.bob), hash(tokens.eva)]);
  await db.query(`INSERT INTO memberships VALUES ('ana','futbol',true,false),('bob','futbol',false,true);
    INSERT INTO busy_slots VALUES ('bob','${slot}','2026-11-28T20:00:00Z','Cita médica privada')`);

  const server = spawn(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url))], {
    env: { ...process.env, DATABASE_URL: url.href, COORDINATION_PORT: "0", COORDINATION_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(async () => {
    server.kill();
    try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await db.end(); }
  });
  let output = "";
  for await (const chunk of server.stdout) {
    output += chunk;
    const port = /puerto (\d+)/.exec(output)?.[1];
    if (port) return `http://127.0.0.1:${port}`;
  }
  const [code] = await once(server, "exit");
  throw new Error(`El servidor terminó antes de escuchar (código ${code})`);
}

function client(base) {
  return async (path, { token, body, raw } = {}) => {
    const response = await fetch(base + path, {
      method: body === undefined && raw === undefined ? "GET" : "POST",
      headers: { ...(token && { authorization: `Bearer ${token}` }), "content-type": "application/json" },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    return { status: response.status, body: await response.json() };
  };
}

test("la API sólo entrega proyecciones autorizadas y rechaza entradas fuera de contrato", async t => {
  const call = client(await startServer(t));
  const check = { recipient: "bob", group: "futbol", slot, minutes: 60 };

  await t.test("health no requiere credencial", async () => {
    assert.deepEqual(await call("/health"), { status: 200, body: { status: "ok" } });
  });

  await t.test("sin token o con token desconocido responde 401", async () => {
    assert.equal((await call("/tools")).status, 401);
    assert.equal((await call("/tools", { token: "inventado" })).status, 401);
    assert.equal((await call("/tools/availability_check", { body: check })).status, 401);
  });

  await t.test("el catálogo publica esquemas estrictos", async () => {
    const { status, body } = await call("/tools", { token: tokens.ana });
    assert.equal(status, 200);
    for (const tool of body.tools) assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  });

  await t.test("herramienta desconocida responde 404", async () => {
    assert.equal((await call("/tools/drop_tables", { token: tokens.ana, body: {} })).status, 404);
  });

  await t.test("JSON inválido, campos extra o tipos incorrectos responden 400", async () => {
    const path = "/tools/availability_check";
    assert.equal((await call(path, { token: tokens.eva, raw: "{no es json" })).status, 400);
    // Suplantación: la identidad viene sólo del token, nunca de los argumentos.
    assert.deepEqual(await call(path, { token: tokens.eva, body: { ...check, actor: "ana" } }),
      { status: 400, body: { error: "invalid_input" } });
    assert.equal((await call(path, { token: tokens.ana, body: { ...check, minutes: "60" } })).status, 400);
    assert.equal((await call(path, { token: tokens.ana, body: { ...check, slot: "mañana" } })).status, 400);
  });

  await t.test("cuerpos sobre 64 KiB responden 413", async () => {
    const body = { ...check, group: "x".repeat(70 * 1024) };
    assert.equal((await call("/tools/availability_check", { token: tokens.ana, body })).status, 413);
  });

  await t.test("sólo se comparte libre/ocupado, nunca el detalle del evento", async () => {
    const { status, body } = await call("/tools/availability_check", { token: tokens.ana, body: check });
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body).sort(), ["request_id", "status"]);
    assert.equal(body.status, "busy");
    assert.doesNotMatch(JSON.stringify(body), /médica/);
  });

  await t.test("sin permiso, la respuesta no distingue si la persona existe", async () => {
    const outsider = await call("/tools/availability_check", { token: tokens.eva, body: check });
    const ghost = await call("/tools/availability_check", {
      token: tokens.ana, body: { ...check, recipient: "fantasma" },
    });
    assert.deepEqual(outsider, { status: 200, body: { status: "not_shareable" } });
    assert.deepEqual(ghost, outsider);
  });
});
