import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import { meetingTools } from "../dist/meetings.js";

const schema = "meetings_" + randomUUID().replaceAll("-", "");
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Run with TEST_DATABASE_URL");
const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
const first = "2026-11-28T16:00:00.000Z";
const second = "2026-11-28T17:00:00.000Z";
const args = { recipients: ["ana", "carla"], slots: [first, second], minutes: 60, group: "futbol" };
const denied = { status: "not_shareable" };

before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const file of ["01-core.sql", "02-meetings.sql"]) {
    await pool.query(await readFile(new URL("../sql/" + file, import.meta.url), "utf8"));
  }
  await pool.query(`INSERT INTO people SELECT name, name FROM unnest(ARRAY['ana','bob','carla','outsider']) AS name`);
  await pool.query(`INSERT INTO memberships SELECT id, 'futbol', true, true FROM people WHERE id <> 'outsider'`);
  await pool.query(`INSERT INTO busy_slots VALUES ('bob',$1,$2,'private title')`, [first, second]);
});

after(async () => {
  try { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  finally { await pool.end(); }
});

async function call(me, toolName, args) {
  const tool = meetingTools.find(tool => tool.name === "meeting_" + toolName);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const response = await tool.run(db, me, args);
    await db.query("COMMIT");
    return response;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

test("independent responses choose a common slot including the organizer, and concurrent retries confirm once", async () => {
  const { id, status } = await call("bob", "propose", args);
  assert.equal(status, "collecting");
  assert.ok((await call("ana", "inbox", {})).meetings.some(meeting => meeting.id === id));
  assert.deepEqual(await call("outsider", "respond", { id }), denied);
  const partial = await call("ana", "respond", { id });
  assert.equal(partial.status, "collecting");
  assert.equal(partial.slot, undefined);
  assert.ok(!(await call("ana", "inbox", {})).meetings.some(meeting => meeting.id === id));

  const proposal = await call("carla", "respond", { id });
  assert.deepEqual(proposal, {
    id, organizer: "bob", participants: ["ana", "bob", "carla"],
    minutes: 60, status: "proposed", slot: second,
  });
  assert.deepEqual(await call("outsider", "decide", { id, accept: true }), denied);
  assert.deepEqual((await call("ana", "inbox", {})).meetings.find(meeting => meeting.id === id), proposal);
  for (const participant of ["bob", "ana"]) {
    assert.equal((await call(participant, "decide", { id, accept: true })).status, "proposed");
  }
  const repeated = await Promise.all([1, 2].map(() => call("carla", "decide", { id, accept: true })));
  assert.deepEqual(repeated.map(r => r.status), ["confirmed", "confirmed"]);
  assert.ok(!(await call("carla", "inbox", {})).meetings.some(meeting => meeting.id === id));
  assert.equal((await pool.query("SELECT id FROM meetings WHERE id=$1 AND status='confirmed'", [id])).rowCount, 1);
});

test("revocation hides the request and an unanswered invitee is never counted as free", async () => {
  const { id } = await call("bob", "propose", args);
  await call("ana", "respond", { id });
  await pool.query("UPDATE memberships SET can_share=false WHERE person_id='ana'");
  try {
    assert.deepEqual(await call("bob", "get", { id }), denied);
    assert.deepEqual(await call("carla", "respond", { id }), denied);
    assert.ok(!(await call("carla", "inbox", {})).meetings.some(meeting => meeting.id === id));
  } finally {
    await pool.query("UPDATE memberships SET can_share=true WHERE person_id='ana'");
  }
  assert.equal((await call("bob", "get", { id })).status, "collecting");
  assert.equal((await call("carla", "respond", { id })).status, "proposed");
  assert.equal((await call("ana", "decide", { id, accept: false })).status, "declined");
  assert.equal((await call("ana", "decide", { id, accept: true })).status, "declined");
});

test("a different proposal requires fresh acceptances and can have no shared slot", async () => {
  assert.deepEqual(await call("outsider", "propose", args), denied);
  const { id } = await call("bob", "propose", { ...args, slots: [first] });
  await call("ana", "respond", { id });
  assert.equal((await call("carla", "respond", { id })).status, "no_shared_slot");
  const changed = await call("bob", "propose", { ...args, slots: [second] });
  assert.notEqual(changed.id, id);
  await call("ana", "respond", { id: changed.id });
  await call("carla", "respond", { id: changed.id });
  assert.equal((await call("bob", "decide", { id: changed.id, accept: true })).status, "proposed");
});

test("keeps the organizer's priority when multiple options are free", async () => {
  const later = "2026-11-28T18:00:00.000Z";
  const { id } = await call("bob", "propose", { ...args, slots: [later, first, second] });
  await call("ana", "respond", { id });
  const proposal = await call("carla", "respond", { id });
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.slot, later);
});
