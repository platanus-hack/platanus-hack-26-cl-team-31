import { describe, expect, it } from "vitest";
import { flowVisibility } from "./flow-visibility.js";
import { BROKER, type FlowActor, type FlowEvent } from "./model.js";
import { scenarioEvents } from "./scenario.js";
import { emptyFlowState, reduceFlow } from "./state.js";

describe("flowVisibility", () => {
  const owner = { key: "ana@Sideband.app", label: "Ana Pérez" };

  it("matches a default owner by exact address, display name or local part", () => {
    for (const query of ["ana@sideband.app", "ana pérez", "ana"]) {
      expect(flowVisibility(null, [query], new Set()).ownerShown(owner)).toBe(true);
    }
    expect(flowVisibility(null, ["an"], new Set()).ownerShown(owner)).toBe(false);
    expect(flowVisibility(null, null, new Set()).ownerShown(owner)).toBe(true);
  });

  it("uses the explicit owner selection, including an empty selection, after setup", () => {
    expect(flowVisibility(new Set([owner.key]), ["bob"], new Set()).ownerShown(owner)).toBe(true);
    expect(flowVisibility(new Set(), ["ana"], new Set()).ownerShown(owner)).toBe(false);
  });

  it.each(["agent:dani-codex", "agent:ana-whatsapp", "owner@ana@sideband.app"])(
    "hides the entire escalated request when participant %s is hidden",
    (hidden) => {
      const events = scenarioEvents();
      const state = events.reduce((flow, event) => reduceFlow(flow, event, event.at), emptyFlowState());
      const escalation = events.filter((event) => event.requestId === "req-dani-ana");
      expect(escalation.some((event) => event.from === BROKER && event.to === BROKER)).toBe(true);
      const visible = flowVisibility(null, null, new Set());
      expect(escalation.every((event) => visible.eventVisibleIn(state, event))).toBe(true);
      const filtered = flowVisibility(null, null, new Set([hidden]));
      expect(escalation.filter((event) => filtered.eventVisibleIn(state, event))).toEqual([]);
      expect(events.some((event) => event.requestId === "req-bob-carla" && filtered.eventVisibleIn(state, event))).toBe(true);
    },
  );

  it("applies the concrete agent's filter to earlier events involving its provisional identity", () => {
    const provisional: FlowActor = { id: "agent@ana", role: "agent", owner, label: "Agente", placeholder: true };
    const agent: FlowActor = { id: "agent:ana-claude", role: "agent", owner, label: "Claude" };
    const ask: FlowEvent = { id: "1", at: 1, step: "ask", status: "pending", from: provisional, to: BROKER, requestId: "r", meta: {} };
    const state = reduceFlow(emptyFlowState(), ask, 1);
    const joined: FlowEvent = { id: "2", at: 2, step: "joined", status: "ok", from: agent, to: agent, meta: {} };
    const identified = reduceFlow(state, joined, 2);
    const policy: FlowEvent = { ...ask, id: "3", at: 3, from: BROKER, step: "policy", status: "allowed" };
    for (const event of [ask, policy]) {
      expect(flowVisibility(null, null, new Set()).eventVisibleIn(identified, event)).toBe(true);
      expect(flowVisibility(null, null, new Set([agent.id])).eventVisibleIn(identified, event)).toBe(false);
    }
  });
});
