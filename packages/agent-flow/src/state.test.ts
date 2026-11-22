import { describe, expect, it } from "vitest";

import { BROKER, type FlowActor, type FlowEvent } from "./model.js";
import { scenarioEvents } from "./scenario.js";
import { activities, emptyFlowState, foldFlow, reduceFlow, resolveId } from "./state.js";

const owner = { key: "bob@sideband.app", label: "Bob" };
const placeholder: FlowActor = { id: "agent@bob@sideband.app", role: "agent", label: "Agente", owner, placeholder: true };
const grok: FlowActor = { id: "agent:b1", role: "agent", label: "Grok Bot", owner, channel: "Grok Bot" };
const ana: FlowActor = { id: "agent:a1", role: "agent", label: "Claude Code", owner: { key: "ana@sideband.app", label: "Ana" } };

const event = (id: string, fields: Partial<FlowEvent>): FlowEvent => ({
  id,
  at: Number(id),
  step: "ask",
  status: "pending",
  from: BROKER,
  to: BROKER,
  requestId: "r1",
  meta: {},
  ...fields,
});

describe("reduceFlow", () => {
  it("replaces a placeholder agent with the concrete one and keeps its slot", () => {
    let state = emptyFlowState();
    state = reduceFlow(state, event("1", { step: "ask", from: ana, to: BROKER }), 0);
    state = reduceFlow(state, event("2", { step: "escalated", from: BROKER, to: placeholder }), 1);
    const order = state.actors.get(placeholder.id)!.order;
    state = reduceFlow(state, event("6", { step: "wake", status: "ok", from: BROKER, to: grok }), 2);
    expect(state.actors.has(placeholder.id)).toBe(false);
    expect(state.actors.get(grok.id)!.order).toBe(order);
    expect(resolveId(state, placeholder.id)).toBe(grok.id);
    // Un provisional posterior del mismo titular apunta al agente conocido.
    state = reduceFlow(state, event("4", { step: "reply", from: placeholder, to: BROKER }), 3);
    expect([...state.actors.keys()]).toEqual([ana.id, grok.id]);
  });

  it("derives waiting, thinking and deciding from the request phases", () => {
    let state = emptyFlowState();
    state = reduceFlow(state, event("1", { step: "ask", from: ana, to: BROKER }), 0);
    state = reduceFlow(state, event("2", { step: "wake", status: "ok", from: BROKER, to: grok }), 1);
    expect(Object.fromEntries(activities(state))).toEqual({ [ana.id]: "waiting", [grok.id]: "thinking" });

    const human: FlowActor = { id: "owner@bob@sideband.app", role: "owner", label: "Titular", owner };
    state = reduceFlow(state, event("3", { step: "reply", from: grok, to: BROKER }), 2);
    state = reduceFlow(state, event("4", { step: "escalated", status: "escalated", from: BROKER, to: human }), 3);
    expect(Object.fromEntries(activities(state))).toEqual({ [ana.id]: "waiting", [human.id]: "deciding" });

    state = reduceFlow(state, event("5", { step: "delivered", status: "delivered", from: BROKER, to: ana }), 4);
    expect(activities(state).size).toBe(0);
  });

  it("produces the same state for the same events", () => {
    const run = () => scenarioEvents().reduce((state, e, i) => reduceFlow(state, e, i * 100), emptyFlowState());
    const a = run();
    const b = run();
    expect([...a.actors]).toEqual([...b.actors]);
    expect([...a.requests]).toEqual([...b.requests]);
    expect(a.log.map((e) => e.event.id)).toEqual(b.log.map((e) => e.event.id));
    // Escenario: 8 titulares, 8 agentes y el titular Ana que decide. Hugo salió de la red.
    expect(a.owners.size).toBe(8);
    expect([...a.actors.values()].filter((e) => e.actor.role === "agent")).toHaveLength(8);
    expect(a.actors.get("agent:u-hugo:hugo-grok")?.presence).toBe("left");
    expect(a.actors.get("agent:u-fran:fran-grok")?.presence).toBe("present");
    expect([...a.actors.values()].filter((e) => e.actor.role === "owner").map((e) => e.actor.owner.label)).toEqual(["Ana"]);
    expect([...a.requests.values()].every((t) => t.phase === "closed")).toBe(true);
  });
});

describe("presence", () => {
  const joined = (id: string, at: number, actor: FlowActor, snapshot = false): FlowEvent => ({ id, at, step: "joined", status: "ok", from: actor, to: actor, meta: snapshot ? { snapshot } : {} });
  const left = (id: string, at: number, actor: FlowActor): FlowEvent => ({ id, at, step: "left", status: "expired", from: actor, to: actor, meta: {} });

  it("is idempotent and keeps passive participants in the network", () => {
    let state = emptyFlowState();
    state = reduceFlow(state, joined("1", 10, grok), 0);
    state = reduceFlow(state, joined("2", 20, grok), 1);
    expect(state.actors.get(grok.id)).toMatchObject({ presence: "present", joinedT: 0 });
    expect(state.log).toHaveLength(1);
    expect(activities(state).size).toBe(0);
  });

  it("ignores an older event that arrives late", () => {
    let state = emptyFlowState();
    state = reduceFlow(state, left("2", 20, grok), 0);
    state = reduceFlow(state, joined("1", 10, grok), 1);
    expect(state.actors.get(grok.id)?.presence).toBe("left");
  });

  it("applies the snapshot silently and brings a participant back when it acts again", () => {
    let state = emptyFlowState();
    state = reduceFlow(state, joined("s", 1, grok, true), 0);
    expect(state.log).toHaveLength(0);
    state = reduceFlow(state, left("2", 5, grok), 1);
    state = reduceFlow(state, event("6", { step: "wake", status: "ok", from: BROKER, to: grok }), 2);
    expect(state.actors.get(grok.id)).toMatchObject({ presence: "present", joinedT: 2 });
  });
});

describe("foldFlow", () => {
  it("equals folding the first i events, with or without cached snapshots", async () => {
    const { foldFlow } = await import("./state.js");
    const events = [...scenarioEvents(), ...scenarioEvents(Date.UTC(2026, 10, 21, 16)).map((e) => ({ ...e, id: `b-${e.id}` }))];
    const times = events.map((_, i) => i * 100);
    const cache = new Map();
    for (const i of [0, 1, 7, 49, 50, 51, 99, events.length]) {
      const expected = events.slice(0, i).reduce((state, e, k) => reduceFlow(state, e, times[k]!), emptyFlowState());
      const plain = foldFlow(events, times, i);
      const cached = foldFlow(events, times, i, cache, 10);
      for (const state of [plain, cached]) {
        expect([...state.actors]).toEqual([...expected.actors]);
        expect([...state.requests]).toEqual([...expected.requests]);
        expect(state.log.map((e) => e.event.id)).toEqual(expected.log.map((e) => e.event.id));
      }
    }
    expect(cache.size).toBeGreaterThan(0);
  });
});

describe("foldFlow with a base (live window)", () => {
  it("folding the kept tail from the state after the dropped head equals folding everything", () => {
    const events = scenarioEvents();
    const times = events.map((_, i) => i * 10);
    const dropped = Math.floor(events.length / 2);
    const base = foldFlow(events, times, dropped);
    const windowed = foldFlow(events.slice(dropped), times.slice(dropped), events.length - dropped, undefined, 50, base);
    const full = foldFlow(events, times, events.length);
    expect([...windowed.actors.keys()]).toEqual([...full.actors.keys()]);
    expect([...windowed.requests.values()].map((r) => r.status)).toEqual([...full.requests.values()].map((r) => r.status));
    expect(windowed.log.map((e) => e.event.id)).toEqual(full.log.map((e) => e.event.id));
  });
});
