import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { configureBroker, isolatedDatabase, listenForWakes, startBroker } from "./contact-stack.mjs";

vi.mock("../src/contact-runtime.mjs", () => ({
  askContactOwner: vi.fn(async (interest, source) => {
    const interests = JSON.parse(await readFile(source, "utf8"));
    return { matches: interests.includes(interest) };
  }),
}));

const contacts = [
  { id: "bob", name: "Bob" },
  { id: "jane", name: "Jane" },
  { id: "luz", name: "Luz" },
];

it("expone solamente la agenda de Ana y rechaza otra dirección antes de pedirle datos al broker", async () => {
  vi.stubEnv("TELEMETRY_SINK", "off");
  onTestFinished(() => vi.unstubAllEnvs());
  const { createContactQueries } = await import("../src/contact-broker.mjs");
  const agent = { ask: vi.fn() };
  const session = createContactQueries(contacts, { agent });
  expect(session.listContacts()).toEqual([
    { name: "Bob", address: "demo-bob@sideband.app" },
    { name: "Jane", address: "demo-jane@sideband.app" },
    { name: "Luz", address: "demo-luz@sideband.app" },
  ]);
  await expect(session.ask("demo-eva@sideband.app", "interest_check", { interest: "cerámica" })).rejects.toThrow(/agenda/);
  expect(agent.ask).not.toHaveBeenCalled();
});

it.skipIf(!process.env.TEST_DATABASE_URL)("aísla las solicitudes por sesión y recupera sus propias respuestas después de reiniciar el broker", async () => {
  const cleanup = new AsyncDisposableStack();
  cleanup.defer(() => vi.unstubAllEnvs());
  onTestFinished(() => cleanup.disposeAsync());
  vi.stubEnv("TELEMETRY_SINK", "off");
  vi.stubEnv("NODE_ENV", "development");
  const db = await isolatedDatabase(cleanup);
  for (const file of ["01-core.sql", "04-demo-profiles.sql"]) {
    await db.query(await readFile(new URL("../../server/sql/" + file, import.meta.url), "utf8"));
  }
  const root = await mkdtemp(join(tmpdir(), "sideband-contact-test-"));
  cleanup.defer(() => rm(root, { recursive: true, force: true }));
  const fixtureId = randomUUID();
  const local = join(root, ".agents-local");
  const overrides = join(local, "contact-sessions", fixtureId);
  await mkdir(overrides, { recursive: true });
  for (const { id, name } of [{ id: "ana", name: "Ana" }, ...contacts]) {
    const readers = ["bob", "jane"].includes(id) ? ["ana"] : [];
    await db.query("INSERT INTO people(id, token_hash) VALUES ($1, $1)", [id]);
    await db.query("INSERT INTO demo_profiles(person_id, display_name, interest_readers) VALUES ($1,$2,$3)", [id, name, readers]);
    await writeFile(join(local, id + "-interests.json"), JSON.stringify(id === "bob" ? ["cerámica"] : []));
  }
  await writeFile(join(overrides, "bob.json"), "[]");

  await configureBroker();
  const { contactAddress, createContactQueries } = await import("../src/contact-broker.mjs");
  const { seedContactBroker } = await import("../src/seed-contact-broker.mjs");
  const { handleContactWake } = await import("../src/contact-wake.mjs");
  const { notices, errors } = await listenForWakes(cleanup, handleContactWake, root);
  const stop = await startBroker(cleanup);
  await seedContactBroker();

  const first = createContactQueries(contacts);
  const second = createContactQueries(contacts.map(contact => ({ ...contact, override: contact.id === "bob" })), { fixtureId });
  const interest = { interest: "cerámica" };
  const bob = contactAddress("bob");
  const jane = contactAddress("jane");
  const [regular, overridden, other, privateQuestion, blocked] = await Promise.all([
    first.ask(bob, "interest_check", interest),
    second.ask(bob, "interest_check", interest),
    second.ask(jane, "interest_check", interest),
    first.ask(bob, "question", { text: "¿Cuál es tu domicilio?", category: "general" }),
    first.ask(contactAddress("luz"), "interest_check", interest),
  ]);
  expect(regular.requestId).not.toBe(overridden.requestId);
  expect(privateQuestion.decision).toBe("deny");
  expect(blocked.decision).toBe("deny");
  await expect(second.result(regular.requestId)).rejects.toThrow(/fuera de esta sesión/);
  const answers = await Promise.all([first.result(regular.requestId), second.result(overridden.requestId), second.result(other.requestId)]);
  expect(answers).toMatchObject([
    { to: bob, decision: "allow", result: { matches: true } },
    { to: bob, decision: "allow", result: { matches: false } },
    { to: jane, decision: "allow", result: { matches: false } },
  ]);
  expect(errors).toEqual([]);
  expect(notices).toHaveLength(3);
  expect(notices).toEqual(expect.arrayContaining([
    { id: "bob", requestId: regular.requestId }, { id: "bob", requestId: overridden.requestId },
    { id: "jane", requestId: other.requestId },
  ]));
  const deniedJobs = await db.query("SELECT request_id FROM sideband.wake_jobs WHERE request_id = ANY($1)", [[privateQuestion.requestId, blocked.requestId]]);
  expect(deniedJobs.rows).toEqual([]);

  await stop();
  await startBroker(cleanup);
  const reopened = createContactQueries(contacts);
  await expect(reopened.result(regular.requestId)).rejects.toThrow(/fuera de esta sesión/);
  expect(await first.result(regular.requestId)).toEqual(answers[0]);
  expect(await first.result(privateQuestion.requestId)).toEqual(privateQuestion);
}, 40_000);
