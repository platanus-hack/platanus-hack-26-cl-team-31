import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { availabilityTools } from "../dist/availability.js";

async function database(t) {
  assert.ok(process.env.TEST_DATABASE_URL, "Run pnpm bootstrap to provision TEST_DATABASE_URL");
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = await pool.connect();
  const owner = await pool.connect();
  const schema = "availability_" + randomUUID().replaceAll("-", "");
  t.after(async () => {
    await owner.query("ROLLBACK");
    await db.query("ROLLBACK");
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    owner.release();
    db.release();
    await pool.end();
  });
  await db.query(`CREATE SCHEMA ${schema}`);
  for (const client of [db, owner]) await client.query(`SET search_path TO ${schema}`);
  await db.query(await readFile(new URL("../sql/01-core.sql", import.meta.url), "utf8"));
  await db.query(`INSERT INTO people VALUES ('ana','a'),('bob','b'),('eva','e');
    INSERT INTO memberships VALUES ('ana','futbol',true,false),('bob','futbol',false,true)`);
  return { db, owner };
}

const run = (client, name, me, args) => availabilityTools.find(tool => tool.name === name).run(client, me, args);
const query = { recipient: "bob", group: "futbol", slot: "2026-11-28T19:00:00Z", minutes: 60 };
const denied = { status: "not_shareable" };

test("revoking after calculation blocks delivery, saved answers and future reads", async (t) => {
  const { db, owner } = await database(t);
  const saved = await run(db, "availability_check", "ana", query);
  assert.equal(saved.status, "available");

  // Hold the insert after the calendar read. The delivery check must see the
  // owner's commit even though the requester transaction started before it.
  await owner.query("BEGIN");
  await owner.query("LOCK TABLE availability_requests IN SHARE MODE");
  await db.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  const { rows: [{ pid }] } = await db.query("SELECT pg_backend_pid() AS pid");
  const delivery = run(db, "availability_check", "ana", query);
  try {
    const deadline = Date.now() + 5000;
    while (true) {
      const blocked = await owner.query("SELECT pg_backend_pid() = ANY(pg_blocking_pids($1)) AS waiting", [pid]);
      if (blocked.rows[0].waiting) break;
      assert.ok(Date.now() < deadline, "reader should pause between calendar calculation and delivery");
      await setTimeout(10);
    }
    await run(owner, "group_permission", "bob", { group: "futbol", can_share: false });
    await owner.query("COMMIT");
  } finally {
    // Always release the lock, including on assertion failure.
    await owner.query("ROLLBACK");
    assert.deepEqual(await delivery, denied);
  }
  await db.query("COMMIT");
  assert.deepEqual(await run(db, "request_get", "ana", { request_id: saved.request_id }), denied);
  assert.deepEqual(await run(db, "availability_check", "ana", query), denied);

  await run(owner, "group_permission", "bob", { group: "futbol", can_share: true });
  assert.equal((await run(db, "availability_check", "ana", query)).status, "available");
  await run(owner, "group_leave", "bob", { group: "futbol" });
  assert.deepEqual(await run(db, "availability_check", "ana", query), denied);
});

test("discovery respects the published audience and confers no calendar access", async (t) => {
  const { db, owner } = await database(t);
  const listing = { interest: "fútbol" };
  const groupListing = { ...listing, group: "futbol" };
  const bob = { entries: [{ person: "bob", interest: listing.interest }] };
  const empty = { entries: [] };
  await run(owner, "interest_publish", "bob", groupListing);
  assert.deepEqual(await run(db, "interest_search", "ana", groupListing), bob);
  assert.deepEqual(await run(db, "interest_search", "ana", listing), empty);
  assert.deepEqual(await run(db, "interest_search", "eva", groupListing), empty);
  await run(owner, "interest_publish", "bob", listing);
  assert.deepEqual(await run(db, "interest_search", "eva", listing), bob);
  assert.deepEqual(await run(db, "availability_check", "eva", query), denied);
  await run(owner, "interest_withdraw", "bob", listing);
  assert.deepEqual(await run(db, "interest_search", "eva", listing), empty);
  await run(owner, "group_leave", "bob", { group: "futbol" });
  assert.deepEqual(await run(db, "interest_search", "ana", groupListing), empty);
});
