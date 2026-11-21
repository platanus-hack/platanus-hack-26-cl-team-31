import assert from "node:assert/strict";
import test from "node:test";
import { listScenarios, generateWorld, loadScenario } from "../src/world.mjs";
import { meetingView, shapes } from "../src/shapes.mjs";

test("misma semilla → mismo mundo; otra semilla → otro mundo", () => {
  const a = generateWorld(loadScenario("hundred"));
  const b = generateWorld(loadScenario("hundred"));
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.memberships, b.memberships);
  assert.notEqual(generateWorld(loadScenario("hundred", { seed: "otra" })).hash, a.hash);
});

test("todos los escenarios cargan y respetan --agents", () => {
  for (const name of listScenarios()) {
    const world = generateWorld(loadScenario(name, { agents: 20 }));
    assert.equal(world.agents.length, 20, name);
    assert.ok(world.busy.every(b => b.title.includes(world.marker)), "cada título privado lleva el marcador");
  }
});

test("el oráculo replica calendar_is_free y la regla bilateral", () => {
  const world = generateWorld(loadScenario("smoke"));
  const b = /** @type {(typeof world.busy)[number]} */ (world.busy[0]);
  assert.equal(world.isFree(b.person, b.start, 1), false);
  const outsider = /** @type {string} */ (world.outsiders[0]);
  assert.equal(world.allowed(outsider, /** @type {string} */ (world.agents[0]), /** @type {string} */ (world.groups[0])), false);
});

test("validadores de forma rechazan claves extra", () => {
  assert.equal(shapes.availability_check?.({ status: "not_shareable" }), null);
  assert.notEqual(shapes.availability_check?.({ status: "not_shareable", title: "x" }), null);
  const view = { id: "00000000-0000-4000-8000-000000000000", organizer: "a", participants: ["a", "b"], minutes: 60, status: "proposed", slot: "2026-12-07T12:00:00.000Z" };
  assert.equal(meetingView(view), null);
  assert.notEqual(meetingView({ ...view, slots: [] }), null);
});
