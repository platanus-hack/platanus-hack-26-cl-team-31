import { MinHeap } from "../heap.js";
import type { NodeId } from "../model.js";
import { arcWeight, type AdjacencyView } from "../view.js";

/**
 * Tabla de landmarks para ALT (A*, Landmarks, desigualdad triangular).
 *
 * Para L landmarks se guarda d(L, v) para todo v. Como el grafo es simétrico,
 * |d(L,t) − d(L,v)| ≤ d(v,t) es una cota inferior consistente. Con un filtro de
 * permisos el grafo efectivo es un subgrafo, cuyas distancias solo crecen: la
 * cota sigue siendo válida.
 *
 * Modos:
 *  - "effective": distancias con penalización de hubs (cotas más ajustadas),
 *    pero cualquier mutación del grafo (cambia grados → pesos) las invalida.
 *  - "base": distancias con `base` solamente (≤ peso real). Más flojas, pero
 *    solo las invalida una arista nueva o un `base` menor; borrar aristas o
 *    cambios de grado no.
 */
export type LandmarkMode = "effective" | "base";

export interface FullGraphView extends AdjacencyView {
  nodeIds(): Iterable<NodeId>;
}

export class LandmarkTable {
  readonly landmarks: NodeId[] = [];
  private readonly index = new Map<NodeId, number>();
  private readonly dist: Float64Array[] = [];

  private constructor(
    readonly mode: LandmarkMode,
    /** Versión del índice con la que se construyó (para detectar staleness). */
    readonly version: number,
  ) {}

  /**
   * Elige `count` landmarks con la heurística "farthest": cada nuevo landmark es
   * el nodo alcanzable más lejano de los ya elegidos. Costo: `count` Dijkstras
   * completos, O(L·(V+E)·log V) tiempo y O(L·V) memoria.
   */
  static build(view: FullGraphView, count: number, mode: LandmarkMode, version: number, seedNode?: NodeId): LandmarkTable {
    const table = new LandmarkTable(mode, version);
    for (const id of view.nodeIds()) table.index.set(id, table.index.size);
    const n = table.index.size;
    if (n === 0 || count <= 0) return table;
    const ids = [...table.index.keys()];
    const minDist = new Float64Array(n).fill(Infinity);
    let next: NodeId = seedNode ?? (ids[0] as NodeId);
    // El primer Dijkstra desde la semilla solo sirve para encontrar un extremo.
    const first = table.sssp(view, next);
    next = farthest(ids, first) ?? next;
    for (let l = 0; l < count; l++) {
      const d = table.sssp(view, next);
      table.landmarks.push(next);
      table.dist.push(d);
      for (let i = 0; i < n; i++) if ((d[i] as number) < (minDist[i] as number)) minDist[i] = d[i] as number;
      const cand = farthest(ids, minDist);
      if (!cand || table.landmarks.includes(cand)) break;
      next = cand;
    }
    return table;
  }

  /** Potencial h(v) = max_L |d(L,t) − d(L,v)| para un destino fijo. */
  potentialTo(target: NodeId): (id: NodeId) => number {
    const ti = this.index.get(target);
    if (ti === undefined) return () => 0;
    const dt = this.dist.map((d) => d[ti] as number);
    const L = this.dist.length;
    return (id) => {
      const vi = this.index.get(id);
      if (vi === undefined) return 0; // nodo nuevo: sin información
      let best = 0;
      for (let l = 0; l < L; l++) {
        const a = dt[l] as number;
        const b = (this.dist[l] as Float64Array)[vi] as number;
        if (a === Infinity) {
          if (b !== Infinity) return Infinity; // componentes distintas
          continue;
        }
        if (b === Infinity) return Infinity;
        const diff = a > b ? a - b : b - a;
        if (diff > best) best = diff;
      }
      return best;
    };
  }

  get bytes(): number {
    return this.dist.length * this.index.size * 8;
  }

  private sssp(view: AdjacencyView, root: NodeId): Float64Array {
    const d = new Float64Array(this.index.size).fill(Infinity);
    const heap = new MinHeap<NodeId>();
    const ri = this.index.get(root) as number;
    d[ri] = 0;
    heap.push(root, 0);
    const base = this.mode === "base";
    while (heap.size) {
      const u = heap.pop() as NodeId;
      const g = heap.lastKey;
      const ui = this.index.get(u) as number;
      if (g > (d[ui] as number)) continue;
      for (const arc of view.arcs(u) ?? []) {
        const vi = this.index.get(arc.to);
        if (vi === undefined) continue;
        const nd = g + (base ? arc.base : arcWeight(view, arc));
        if (nd < (d[vi] as number)) {
          d[vi] = nd;
          heap.push(arc.to, nd);
        }
      }
    }
    return d;
  }
}

function farthest(ids: readonly NodeId[], d: Float64Array): NodeId | undefined {
  let best = -1;
  let arg: NodeId | undefined;
  for (let i = 0; i < ids.length; i++) {
    const x = d[i] as number;
    if (x !== Infinity && x > best) {
      best = x;
      arg = ids[i];
    }
  }
  return arg;
}
