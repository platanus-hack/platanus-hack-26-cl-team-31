import type { MinHeap } from "./heap.js";
import { flip, type Arc, type NodeId } from "../model.js";
import {
  allowAll,
  type AdjacencyView,
  type EdgeFilter,
  type FetchRequest,
  type Path,
  type SearchStats,
  type TraversalContext,
} from "../view.js";

export const EMPTY: readonly Arc[] = [];
export const DEFAULT_BATCH = 32;

/**
 * Pide la adyacencia de `u` y, de paso, la de hasta `batch - 1` nodos de la
 * frontera que aún no están cargados (recorriendo el heap en orden de arreglo,
 * que aproxima "los más baratos primero"). Así una búsqueda en Postgres hace
 * ~una consulta por capa de expansión en vez de una por nodo.
 */
export function frontierRequest(
  view: AdjacencyView,
  u: NodeId,
  heaps: readonly MinHeap<NodeId>[],
  skip: (id: NodeId) => boolean,
  batch: number,
): FetchRequest {
  const ids: NodeId[] = [u];
  const seen = new Set<NodeId>(ids);
  outer: for (const heap of heaps) {
    for (const id of heap.entries()) {
      if (ids.length >= batch) break outer;
      if (seen.has(id) || skip(id) || view.arcs(id) !== undefined) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids };
}

export function recordFetch(stats: SearchStats, req: FetchRequest): FetchRequest {
  stats.fetches++;
  stats.fetchedNodes += req.ids.length;
  return req;
}

/** Aristas visibles para esta búsqueda (aplica el hook de permisos). */
export function visibleArcs(
  arcs: readonly Arc[],
  filter: EdgeFilter,
  ctx: TraversalContext,
  reversed = false,
): readonly Arc[] {
  if (filter === allowAll) return arcs;
  const out: Arc[] = [];
  for (const arc of arcs) {
    if (reversed ? filter(flip(arc), ctx) : filter(arc, ctx)) out.push(arc);
  }
  return out;
}

/** Sigue los predecesores desde el extremo hasta la raíz, en ese orden. */
export function parentArcs(root: NodeId, end: NodeId, parent: (id: NodeId) => Arc | undefined): Arc[] {
  const arcs: Arc[] = [];
  let cur = end;
  while (cur !== root) {
    const arc = parent(cur);
    if (!arc) throw new Error(`Camino roto en ${cur}`);
    arcs.push(arc);
    cur = arc.from;
  }
  return arcs;
}

export function buildPath(source: NodeId, target: NodeId, cost: number, arcs: Arc[]): Path {
  return { source, target, cost, nodes: [source, ...arcs.map((a) => a.to)], arcs };
}
