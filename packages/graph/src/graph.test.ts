import { describe, expect, it } from "vitest";
import { hubPenalty } from "./cost.js";
import { MinHeap } from "./search/heap.js";
import { MemoryGraphIndex } from "./memory.js";
import { kindOf, topicId, type Arc, type GraphMutation, type NodeId } from "./model.js";
import { interestMutation, membershipMutation, projectCore } from "./projection.js";
import { explain, matchers, type PathAlgorithm } from "./search/api.js";
import { targetedNearest } from "./search/dijkstra.js";
import { rng, syntheticGraph } from "./synthetic.js";
import { allPairs, randomMutations } from "./test-utils.js";
import { arcWeight, runSync, type EdgeFilter, type Path } from "./view.js";

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const close = (a: number, b: number) => (a === Infinity ? b === Infinity : Math.abs(a - b) < 1e-9);

function checkPath(index: MemoryGraphIndex, p: Path, filter?: EdgeFilter) {
  expect(p.nodes[0]).toBe(p.source);
  expect(p.nodes.at(-1)).toBe(p.target);
  let cost = 0;
  p.arcs.forEach((arc, i) => {
    expect(arc.from).toBe(p.nodes[i]);
    expect(arc.to).toBe(p.nodes[i + 1]);
    if (filter) expect(filter(arc, { viewer: p.source })).toBe(true);
    cost += arcWeight(index, arc);
  });
  expect(close(cost, p.cost)).toBe(true);
}

// Bloquea arcos según una función determinista de la arista (incluye orientación).
const blockSome: EdgeFilter = (arc) => arc.scope !== "g1" && !(arc.kind === "related_to" && arc.from < arc.to);

describe("MinHeap", () => {
  it("ordena", () => {
    const r = rng(7);
    const h = new MinHeap<number>();
    const xs = Array.from({ length: 500 }, () => r());
    xs.forEach((x) => h.push(x, x));
    const out: number[] = [];
    while (h.size) out.push(h.pop() as number);
    expect(out).toEqual([...xs].sort((a, b) => a - b));
  });
});

describe("caminos mínimos vs fuerza bruta", () => {
  const algorithms: PathAlgorithm[] = ["dijkstra", "bidirectional", "alt"];
  for (const filter of [undefined, blockSome]) {
    it(`dijkstra / bidireccional / ALT coinciden con Floyd–Warshall (${filter ? "con" : "sin"} filtro)`, () => {
      for (const seed of SEEDS) {
        const { ids, mutations } = randomMutations(seed);
        const index = new MemoryGraphIndex(mutations);
        const ref = allPairs(index, ids, filter);
        const lmEff = index.buildLandmarks(3, "effective");
        for (const s of ids.slice(0, 5)) {
          for (const t of ids) {
            for (const algorithm of algorithms) {
              for (const landmarks of algorithm === "alt" ? [lmEff, undefined] : [undefined]) {
                const res = index.path(s, t, { algorithm, filter, landmarks });
                const expected = ref(s, t);
                const got = res.paths[0]?.cost ?? Infinity;
                expect(close(got, expected), `${algorithm} seed=${seed} ${s}→${t}: ${got} vs ${expected}`).toBe(true);
                if (res.paths[0]) checkPath(index, res.paths[0], filter);
              }
            }
          }
        }
      }
    });
  }

  it("ALT en modo base también es exacto", () => {
    for (const seed of SEEDS) {
      const { ids, mutations } = randomMutations(seed);
      const index = new MemoryGraphIndex(mutations);
      const ref = allPairs(index, ids);
      const lm = index.buildLandmarks(4, "base");
      for (const t of ids) {
        const res = index.path(ids[0] as NodeId, t, { algorithm: "alt", landmarks: lm });
        expect(close(res.paths[0]?.cost ?? Infinity, ref(ids[0] as NodeId, t))).toBe(true);
      }
    }
  });
});

describe("nearest (multi-objetivo)", () => {
  it("devuelve los k más cercanos que cumplen el predicado", () => {
    for (const seed of SEEDS) {
      const { ids, mutations } = randomMutations(seed);
      const index = new MemoryGraphIndex(mutations);
      for (const filter of [undefined, blockSome]) {
        const ref = allPairs(index, ids, filter);
        const s = ids[0] as NodeId;
        const match = matchers.ofKind("person");
        const k = 3;
        const res = index.nearest(s, { match, k, filter });
        const expected = ids
          .filter((id) => id !== s && kindOf(id) === "person" && ref(s, id) < Infinity)
          .map((id) => ref(s, id))
          .sort((a, b) => a - b)
          .slice(0, k);
        expect(res.paths.map((p) => p.cost)).toHaveLength(expected.length);
        res.paths.forEach((p, i) => {
          expect(close(p.cost, expected[i] as number)).toBe(true);
          checkPath(index, p, filter);
        });
      }
    }
  });

  it("targetedNearest (atrás acotado + A*) es exacto para cualquier presupuesto", () => {
    for (const seed of SEEDS) {
      const { ids, mutations } = randomMutations(seed);
      const index = new MemoryGraphIndex(mutations);
      const r = rng(seed);
      const targets = ids.filter(() => r() < 0.3);
      for (const filter of [undefined, blockSome]) {
        const ref = allPairs(index, ids, filter);
        const s = ids[1] as NodeId;
        const expected = targets
          .filter((t) => t !== s && ref(s, t) < Infinity)
          .map((t) => ref(s, t))
          .sort((a, b) => a - b)
          .slice(0, 3);
        for (const backwardBudget of [0, 1, 3, 1000]) {
          const res = runSync(targetedNearest(index, s, { targets, k: 3, filter, backwardBudget }));
          expect(res.paths.map((p) => p.cost).length).toBe(expected.length);
          res.paths.forEach((p, i) => {
            expect(close(p.cost, expected[i] as number), `seed=${seed} budget=${backwardBudget}`).toBe(true);
            checkPath(index, p, filter);
          });
        }
      }
    }
  });

  it("interestedIn: estrategia targeted = forward", () => {
    const g = syntheticGraph({ people: 3000, seed: 4 });
    const index = new MemoryGraphIndex(g.mutations);
    const r = rng(1);
    const hidePrivate: EdgeFilter = (arc) => arc.scope === "";
    for (let i = 0; i < 40; i++) {
      const s = g.people[Math.floor(r() * g.people.length)] as NodeId;
      const topic = g.topics[Math.floor(r() * g.topics.length)] as NodeId;
      for (const filter of [undefined, hidePrivate]) {
        const a = index.interestedIn(s, topic, { strategy: "forward", k: 10, filter });
        const b = index.interestedIn(s, topic, { strategy: "targeted", k: 10, filter });
        expect(b.paths.map((p) => p.cost.toFixed(9))).toEqual(a.paths.map((p) => p.cost.toFixed(9)));
      }
    }
  });

  it("el predicado solo ve aristas visibles", () => {
    const index = new MemoryGraphIndex([
      membershipMutation({ person_id: "ana", group_id: "club", can_ask: true, can_share: true }),
      membershipMutation({ person_id: "bob", group_id: "club", can_ask: true, can_share: true }),
      interestMutation({ person_id: "bob", interest: "Ajedrez", audience: "secreto" }),
    ]);
    const match = matchers.interestedIn(topicId("ajedrez"));
    expect(index.nearest("person:ana", { match }).paths.map((p) => p.target)).toEqual(["person:bob"]);
    const hidePrivate: EdgeFilter = (arc) => arc.scope === "";
    expect(index.nearest("person:ana", { match, filter: hidePrivate }).paths).toEqual([]);
  });
});

describe("presupuestos", () => {
  it("maxExpanded y maxCost se respetan", () => {
    const g = syntheticGraph({ people: 2000, seed: 3 });
    const index = new MemoryGraphIndex(g.mutations);
    const ref = new MemoryGraphIndex(g.mutations);
    for (const s of g.people.slice(0, 20)) {
      const a = index.nearest(s, { match: matchers.ofKind("person"), k: 10_000, maxExpanded: 50 });
      expect(a.stats.expanded).toBeLessThanOrEqual(50);
      expect(a.stats.stopReason).toBe("maxExpanded");
      const b = index.path(s, g.people[1999] as NodeId, { algorithm: "bidirectional", maxExpanded: 30 });
      expect(b.stats.expanded).toBeLessThanOrEqual(30);

      const maxCost = 6;
      const c = index.nearest(s, { match: matchers.ofKind("person"), k: 10_000, maxCost });
      expect(c.paths.every((p) => p.cost <= maxCost)).toBe(true);
      // y no se pierde nada: todas las personas a costo ≤ maxCost aparecen
      const all = ref.nearest(s, { match: matchers.ofKind("person"), k: 10_000 });
      expect(c.paths.length).toBe(all.paths.filter((p) => p.cost <= maxCost).length);
    }
  });
});

describe("índice incremental", () => {
  function finalState(mutations: GraphMutation[]): GraphMutation[] {
    // Estado final calculado sin el índice: un diccionario de aristas.
    const edges = new Map<string, GraphMutation>();
    const nodes = new Set<NodeId>();
    const key = (a: NodeId, b: NodeId, kind: string, scope: string) => [[a, b].sort().join("|"), kind, scope].join("#");
    for (const m of mutations) {
      if (m.op === "upsertNode") nodes.add(m.id);
      else if (m.op === "upsertEdge") {
        nodes.add(m.a).add(m.b);
        edges.set(key(m.a, m.b, m.kind, m.scope ?? ""), m);
      } else if (m.op === "removeEdge") edges.delete(key(m.a, m.b, m.kind, m.scope ?? ""));
      else {
        nodes.delete(m.id);
        for (const [k, e] of edges) if (e.op === "upsertEdge" && (e.a === m.id || e.b === m.id)) edges.delete(k);
      }
    }
    return [...[...nodes].map((id): GraphMutation => ({ op: "upsertNode", id })), ...edges.values()];
  }

  it("aplicar cambios = reconstruir desde cero", () => {
    for (const seed of SEEDS) {
      const r = rng(seed * 31);
      const { ids, mutations } = randomMutations(seed, 16, 40);
      const index = new MemoryGraphIndex(mutations);
      const log = [...mutations];
      for (let j = 0; j < 40; j++) {
        const x = r();
        const existing = [...index.nodeIds()].flatMap((id) => [...index.arcs(id)]);
        let m: GraphMutation;
        if (x < 0.35 && existing.length) {
          const arc = existing[Math.floor(r() * existing.length)] as Arc;
          m = { op: "removeEdge", a: arc.to, b: arc.from, kind: arc.kind, scope: arc.scope };
        } else if (x < 0.45) {
          m = { op: "removeNode", id: ids[Math.floor(r() * ids.length)] as NodeId };
        } else {
          m = randomMutations(seed * 1000 + j, 16, 3).mutations.at(-1) as GraphMutation;
        }
        index.apply([m]);
        log.push(m);
      }
      const rebuilt = new MemoryGraphIndex(finalState(log));
      expect(index.snapshot()).toEqual(rebuilt.snapshot());
      for (const s of ids.slice(0, 3))
        for (const t of ids) {
          const a = index.path(s, t).paths[0]?.cost ?? Infinity;
          const b = rebuilt.path(s, t).paths[0]?.cost ?? Infinity;
          expect(close(a, b)).toBe(true);
        }
    }
  });

  it("la penalización de hub sigue el grado", () => {
    const index = new MemoryGraphIndex();
    for (let i = 0; i < 10; i++) index.apply([interestMutation({ person_id: `p${i}`, interest: "musica", audience: "" })]);
    expect(index.penalty("topic:musica")).toBeCloseTo(hubPenalty("topic", 10));
    index.apply([interestMutation({ person_id: "p0", interest: "musica", audience: "" }, "delete")]);
    expect(index.penalty("topic:musica")).toBeCloseTo(hubPenalty("topic", 9));
  });

  it("ALT detecta landmarks desactualizados y cae a bidireccional", () => {
    const g = syntheticGraph({ people: 300, seed: 9 });
    const index = new MemoryGraphIndex(g.mutations);
    index.buildLandmarks(4, "effective");
    const [s, t] = [g.people[0] as NodeId, g.people[200] as NodeId];
    expect(index.path(s, t, { algorithm: "alt" }).stats.fallback).toBeUndefined();
    expect(index.path(s, t, { algorithm: "alt", landmarksStale: true }).stats.fallback).toMatch(/desactualizados/);
    index.apply([{ op: "upsertEdge", a: s, b: t, kind: "knows", base: 0.1 }]);
    const res = index.path(s, t, { algorithm: "alt", landmarksStale: false });
    expect(res.stats.fallback).toMatch(/desactualizados/);
    expect(res.paths[0]?.cost).toBeCloseTo(0.1 + (index.penalty(s) + index.penalty(t)) / 2);
  });
});

describe("proyección y explicación", () => {
  it("proyecta tablas core y explica caminos", () => {
    const index = new MemoryGraphIndex(
      projectCore({
        people: [{ id: "ana" }, { id: "bob" }, { id: "eva" }],
        memberships: [
          { person_id: "ana", group_id: "futbol", can_ask: true, can_share: false },
          { person_id: "bob", group_id: "futbol", can_ask: true, can_share: true },
        ],
        interests: [
          { person_id: "bob", interest: " Ajedrez ", audience: "" },
          { person_id: "eva", interest: "ajedrez", audience: "" },
        ],
      }),
    );
    expect(index.arcs("person:ana")[0]?.attrs).toEqual({ canAsk: true, canShare: false });
    const res = index.nearest("person:ana", { match: matchers.interestedIn(topicId("AJEDREZ")), k: 5 });
    expect(res.paths.map((p) => p.target)).toEqual(["person:bob", "person:eva"]);
    expect(explain(res.paths[1] as Path)).toContain("le interesa a");
  });
});
