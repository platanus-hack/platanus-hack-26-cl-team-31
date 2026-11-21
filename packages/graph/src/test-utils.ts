import { baseCost } from "./cost.js";
import { EDGE_KINDS, type Arc, type GraphMutation, type NodeId } from "./model.js";
import { rng } from "./synthetic.js";
import { arcWeight, type AdjacencyView, type EdgeFilter } from "./view.js";

/** Grafo aleatorio pequeño con todos los tipos de nodo y arista. */
export function randomMutations(seed: number, n = 14, m = 26): { ids: NodeId[]; mutations: GraphMutation[] } {
  const rand = rng(seed);
  const kinds = ["person", "person", "person", "group", "topic", "vault"] as const;
  const ids = Array.from({ length: n }, (_, i) => `${kinds[i % kinds.length]}:n${i}` as NodeId);
  const mutations: GraphMutation[] = ids.map((id) => ({ op: "upsertNode", id }));
  for (let j = 0; j < m; j++) {
    const a = ids[Math.floor(rand() * n)] as NodeId;
    const b = ids[Math.floor(rand() * n)] as NodeId;
    if (a === b) continue;
    const kind = EDGE_KINDS[Math.floor(rand() * EDGE_KINDS.length)] as Arc["kind"];
    const scope = rand() < 0.3 ? `g${Math.floor(rand() * 3)}` : "";
    const base = rand() < 0.5 ? baseCost(kind, scope) : Math.round(rand() * 30) / 10;
    mutations.push({ op: "upsertEdge", a, b, kind, scope, base });
  }
  return { ids, mutations };
}

/** Floyd–Warshall dirigido sobre el grafo filtrado: la referencia de fuerza bruta. */
export function allPairs(view: AdjacencyView, ids: readonly NodeId[], filter?: EdgeFilter, viewer?: NodeId) {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  for (const u of ids) {
    for (const arc of view.arcs(u) ?? []) {
      if (filter && !filter(arc, { viewer: viewer ?? u })) continue;
      const i = idx.get(u) as number;
      const j = idx.get(arc.to) as number;
      const row = d[i] as number[];
      row[j] = Math.min(row[j] as number, arcWeight(view, arc));
    }
  }
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const via = (d[i]?.[k] as number) + (d[k]?.[j] as number);
        if (via < (d[i]?.[j] as number)) (d[i] as number[])[j] = via;
      }
  return (a: NodeId, b: NodeId) => d[idx.get(a) as number]?.[idx.get(b) as number] as number;
}
