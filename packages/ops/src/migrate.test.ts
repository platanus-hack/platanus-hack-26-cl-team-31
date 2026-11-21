import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { applyOpsMigrations } from "./index.js";

it.skipIf(!process.env.TEST_DATABASE_URL)("repetir la preparación conserva los eventos de una solicitud", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  const url = new URL(databaseUrl);
  if (!url.pathname.endsWith("_test") || (process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === url.pathname)) {
    throw new Error("Usa una TEST_DATABASE_URL separada.");
  }
  await applyOpsMigrations({ databaseUrl });
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const requestId = randomUUID();
  try {
    await db.query(`INSERT INTO ops.events (service, instance, kind, name, level, request_id)
      VALUES ('coordination', 'test', 'tool', 'coordination.tool.call', 'info', $1)`, [requestId]);
    await expect(applyOpsMigrations({ databaseUrl })).resolves.toEqual([]);
    expect((await db.query("SELECT name FROM ops.events WHERE request_id = $1", [requestId])).rows)
      .toEqual([{ name: "coordination.tool.call" }]);
  } finally {
    try { await db.query("DELETE FROM ops.events WHERE request_id = $1", [requestId]); }
    finally { await db.end(); }
  }
});
