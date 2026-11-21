import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { contactTools } from "../dist/contacts.js";
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
  await db.query(await readFile(new URL("../sql/03-contacts.sql", import.meta.url), "utf8"));
  await db.query(`INSERT INTO people VALUES ('ana','a'),('bob','b'),('eva','e');
    INSERT INTO memberships VALUES ('ana','futbol',true,false),('bob','futbol',false,true)`);
  return { db, owner };
}

const run = (client, name, me, args) => [...availabilityTools, ...contactTools].find(tool => tool.name === name).run(client, me, args);
const query = { recipient: "bob", group: "futbol", slot: "2026-11-28T19:00:00Z", minutes: 60 };
const denied = { status: "not_shareable" };

test("a participant name from conversation resolves under the caller's existing permissions", async (t) => {
  const { db } = await database(t);
  const input = { ...query, recipient: " Bob " };
  assert.equal((await run(db, "availability_check", "ana", input)).status, "available");
  assert.deepEqual(await run(db, "availability_check", "eva", input), denied);
});

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

test("the per-agent catalog describes callable tools and follows each domain's current permissions", async t => {
  const { db, owner } = await database(t);
  const bob = { recipient: "Bob" };
  const catalog = me => run(db, "agent_capabilities", me, bob);
  const before = await catalog("ana");
  assert.deepEqual(before.tools.map(t => t.name), ["availability_check"]);
  const { properties, required } = before.tools[0].inputSchema;
  assert.equal(properties.recipient.const, "bob");
  assert.deepEqual(properties.group.enum, ["futbol"]);
  assert.deepEqual(required.sort(), ["group", "minutes", "recipient", "slot"]);
  assert.deepEqual(await catalog("eva"), { tools: [] });
  assert.deepEqual(await run(db, "agent_capabilities", "ana", { recipient: "nobody" }), { tools: [] });

  const listing = { interest: "guitarra", group: "futbol" };
  await run(owner, "interest_publish", "bob", listing);
  await run(owner, "group_permission", "bob", { group: "futbol", can_share: false });
  const after = await catalog("ana");
  assert.deepEqual(after.tools.map(t => t.name), ["agent_interests"]);
  assert.deepEqual(await run(db, after.tools[0].name, "ana", bob), { interests: ["guitarra"] });
  assert.deepEqual(await run(db, before.tools[0].name, "ana", query), denied);
  assert.deepEqual(await run(db, "agent_interests", "eva", bob), { interests: [] });
  await run(owner, "interest_withdraw", "bob", listing);
  assert.deepEqual(await catalog("ana"), { tools: [] });
});

test("contact search intersects the caller's own address book and the publisher's audience", async t => {
  const { db } = await database(t);
  const bob = { recipient: "Bob" };
  const interest = { interest: "piano" };
  const groupInterest = { ...interest, group: "futbol" };
  const contacts = me => run(db, "list_contacts", me, {});
  const search = me => run(db, "contact_interest_search", me, interest);
  const foundBob = { entries: [{ person: "bob", ...interest }] };
  const empty = { entries: [] };

  await run(db, "interest_publish", "bob", groupInterest);
  await run(db, "interest_publish", "eva", interest);
  assert.deepEqual(await search("ana"), empty);
  assert.deepEqual(await run(db, "contact_connect", "ana", bob), await run(db, "agent_capabilities", "ana", bob));
  assert.deepEqual(await contacts("ana"), { contacts: [{ address: "bob" }] });
  assert.deepEqual(await contacts("eva"), { contacts: [] });
  assert.deepEqual(await search("ana"), foundBob);
  assert.deepEqual(await run(db, "contact_connect", "eva", bob), { tools: [] });
  assert.deepEqual(await search("eva"), empty);
  assert.deepEqual(await run(db, "availability_check", "eva", query), denied);

  await run(db, "interest_publish", "ana", interest);
  assert.deepEqual(await search("bob"), empty); // Ana saving Bob does not add Ana to Bob's address book.
  await run(db, "interest_publish", "bob", interest);
  assert.deepEqual(await search("ana"), foundBob); // Public + group is one match.
  assert.deepEqual(await search("eva"), foundBob);
  await run(db, "interest_withdraw", "bob", interest);
  assert.deepEqual(await search("eva"), empty);
  await run(db, "group_leave", "ana", { group: "futbol" });
  assert.deepEqual(await search("ana"), empty);
  await run(db, "interest_publish", "bob", interest);
  await run(db, "contact_remove", "ana", bob);
  assert.deepEqual(await contacts("ana"), { contacts: [] });
  assert.deepEqual(await search("ana"), empty);
  assert.deepEqual(await search("eva"), foundBob);
});
