import { describe, expect, it } from "vitest";

import { edgeCurve, layoutFlow, pointOnCurve, stageHeightFor, type LayoutInput, type Rect } from "./layout.js";
import { scheduleLive, scheduleReplay } from "./schedule.js";
import { scenarioEvents } from "./scenario.js";

const input = (width: number, height: number, ownerCount: number, agentsPerOwner = 2): LayoutInput => {
  const owners = Array.from({ length: ownerCount }, (_, i) => ({ key: `owner-${i}` }));
  const actors = owners.flatMap((owner, i) => [
    ...Array.from({ length: agentsPerOwner }, (_, j) => ({ id: `${owner.key}/agent-${j}`, ownerKey: owner.key, role: "agent" as const })),
    ...(i % 2 === 0 ? [{ id: `${owner.key}/human`, ownerKey: owner.key, role: "owner" as const }] : []),
  ]);
  return { width, height, owners, actors };
};

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("layoutFlow", () => {
  it("is deterministic", () => {
    const a = layoutFlow(input(900, 540, 5));
    const b = layoutFlow(input(900, 540, 5));
    expect([...a.cards]).toEqual([...b.cards]);
    expect([...a.slots]).toEqual([...b.slots]);
    expect(a.hub).toEqual(b.hub);
  });

  it("puts the broker in the center and the first owner on the left", () => {
    const layout = layoutFlow(input(1000, 600, 3));
    expect(layout.hub.x).toBe(500);
    expect(layout.hubZone.y + layout.hubZone.h / 2).toBe(322);
    const first = layout.cards.get("owner-0")!;
    expect(first.x + first.w).toBeLessThan(layout.hub.x);
    // Sus aristas salen por el borde que mira al broker.
    expect(layout.slots.get("owner-0/agent-0")!.normal).toEqual({ x: 1, y: 0 });
  });

  it.each([
    [1000, 2],
    [1000, 4],
    [960, 5],
    [960, 6],
    [1500, 6],
    [1008, 7],
    [1008, 8],
    [358, 2],
    [358, 4],
    [358, 6],
  ])("keeps a %i px stage with %i owners free of overlaps", (width, owners) => {
    const data = input(width, 0, owners);
    const height = stageHeightFor(width, data.owners, data.actors);
    const layout = layoutFlow({ ...data, height });
    const cards = [...layout.cards.values()];
    expect(cards).toHaveLength(owners);
    for (const card of cards) {
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.x + card.w).toBeLessThanOrEqual(width);
      expect(card.y + card.h).toBeLessThanOrEqual(height);
      expect(overlaps(card, layout.hubZone), "broker").toBe(false);
    }
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) expect(overlaps(cards[i]!, cards[j]!)).toBe(false);
    }
    for (const actor of data.actors) {
      const slot = layout.slots.get(actor.id)!;
      const card = layout.cards.get(actor.ownerKey)!;
      expect(slot.x).toBeGreaterThanOrEqual(card.x);
      expect(slot.y + slot.h).toBeLessThanOrEqual(card.y + card.h);
    }
  });

  it.each([
    [1440, 20],
    [1440, 40],
    [960, 12],
    [960, 24],
    [358, 10],
    [358, 24],
  ])("switches a %i px stage with %i owners to dots without overlaps", (width, owners) => {
    const data = input(width, 0, owners, 1);
    const height = stageHeightFor(width, data.owners, data.actors);
    const layout = layoutFlow({ ...data, height });
    expect(layout.density).toBe("dots");
    const nodes = [...layout.nodes.values()];
    expect(nodes).toHaveLength(owners);
    const r = layout.nodeRadius;
    // Cada avatar ocupa su círculo y su etiqueta debajo.
    const half = layout.compact ? 38 : 44;
    const box = (p: { x: number; y: number }): Rect => ({ x: p.x - half, y: p.y - r, w: half * 2, h: r * 2 + 22 });
    for (const node of nodes) {
      expect(node.x - r).toBeGreaterThanOrEqual(0);
      expect(node.x + r).toBeLessThanOrEqual(width);
      expect(node.y - r).toBeGreaterThanOrEqual(0);
      expect(node.y + r + 22).toBeLessThanOrEqual(height);
      expect(overlaps(box(node), layout.hubZone), "broker").toBe(false);
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) expect(overlaps(box(nodes[i]!), box(nodes[j]!)), `${i}-${j}`).toBe(false);
    }
  });

  it("keeps existing cards in place when someone joins without crossing a capacity step", () => {
    const five = layoutFlow({ ...input(1000, 600, 5) });
    const six = layoutFlow({ ...input(1000, 600, 6) });
    for (let i = 0; i < 5; i++) expect(six.cards.get(`owner-${i}`)).toEqual(five.cards.get(`owner-${i}`));
  });

  it("draws edges from the card to the broker's edge", () => {
    const layout = layoutFlow(input(1000, 560, 2));
    const slot = layout.slots.get("owner-1/agent-0")!;
    const curve = edgeCurve(slot, layout);
    expect(curve.start).toEqual(slot.anchor);
    // Entra por el costado derecho del sello, a su altura.
    expect(curve.end.x).toBe(layout.hub.x + layout.hub.size / 2 + 6);
    expect(Math.abs(curve.end.y - layout.hub.y)).toBeLessThanOrEqual(layout.hub.size / 3);
    expect(pointOnCurve(curve, 0)).toEqual(curve.start);
    expect(pointOnCurve(curve, 1)).toEqual(curve.end);
  });

  it("returns only the hub without owners", () => {
    const layout = layoutFlow({ width: 800, height: 500, owners: [], actors: [] });
    expect(layout.cards.size).toBe(0);
    expect(layout.hubZone.y + layout.hubZone.h / 2).toBe(272);
  });
});

describe("schedule", () => {
  it("keeps replay gaps between the bounds and in order", () => {
    const events = scenarioEvents().filter((e) => !e.meta.snapshot);
    const times = scheduleReplay(events, { minGap: 400, maxGap: 2_000, lead: 500 });
    expect(times[0]).toBe(500);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i]! - times[i - 1]!;
      const wave = events[i]!.step === "joined" && events[i - 1]!.step === "joined";
      expect(gap).toBeGreaterThanOrEqual(wave ? 150 : 400);
      expect(gap).toBeLessThanOrEqual(2_000);
    }
    expect(scheduleReplay(events)).toEqual(scheduleReplay(events));
  });

  it("staggers a live burst", () => {
    expect(scheduleLive(undefined, 1_000)).toBe(1_000);
    expect(scheduleLive(1_000, 1_010, 300)).toBe(1_300);
    expect(scheduleLive(1_000, 5_000, 300)).toBe(5_000);
  });
});
