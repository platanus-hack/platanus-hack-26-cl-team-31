import { MinHeap } from "./heap.js";
import type { Arc, NodeId } from "../model.js";
import {
  allowAll,
  newStats,
  type AdjacencyView,
  type EdgeFilter,
  type Path,
  type SearchGenerator,
  type SearchOptions,
  type SearchStats,
  type TraversalContext,
} from "../view.js";
import { buildPath, DEFAULT_BATCH, EMPTY, frontierRequest, parentArcs, recordFetch, visibleArcs } from "./common.js";

/** Predicado de "nodo objetivo". Recibe solo las aristas visibles para el viewer. */
export type NodeMatcher = (id: NodeId, visibleArcs: readonly Arc[]) => boolean;

export interface DijkstraOptions extends SearchOptions {
  /** Punto a punto: termina al asentar `target`. */
  readonly target?: NodeId;
  /** Multi-objetivo: devuelve los `k` nodos más cercanos que cumplen `match`. */
  readonly match?: NodeMatcher;
  readonly k?: number;
  /** ¿Puede el propio origen ser resultado de `match`? (default: no) */
  readonly includeSource?: boolean;
  /**
   * Potencial A* (cota inferior consistente de la distancia al objetivo más
   * cercano). Con potencial, Dijkstra se convierte en A*; con landmarks, en ALT.
   */
  readonly potential?: (id: NodeId) => number;
}

export interface SearchResult {
  /** Ordenados por costo creciente. */
  readonly paths: Path[];
  readonly stats: SearchStats;
}

interface State {
  dist: number;
  done: boolean;
  parent: Arc | undefined;
  /** Penalización de hub del nodo, leída una sola vez. */
  readonly pen: number;
}

/**
 * Dijkstra con heap binario, salida temprana, presupuestos de costo y de nodos
 * expandidos, y carga perezosa de adyacencias por lotes de frontera.
 */
export function* dijkstra(view: AdjacencyView, source: NodeId, opts: DijkstraOptions = {}): SearchGenerator<SearchResult> {
  const stats = newStats();
  const paths: Path[] = [];
  const { target, match, potential } = opts;
  const k = opts.k ?? (match ? 10 : 1);
  const maxCost = opts.maxCost ?? Infinity;
  const maxExpanded = opts.maxExpanded ?? Infinity;
  const filter = opts.filter ?? allowAll;
  const ctx: TraversalContext = { viewer: opts.viewer ?? source };
  const batch = opts.batchSize ?? DEFAULT_BATCH;

  const state = new Map<NodeId, State>();
  const heap = new MinHeap<NodeId>();
  const h0 = potential ? potential(source) : 0;
  if (h0 === Infinity) {
    stats.stopReason = "unreachable";
    return { paths, stats };
  }
  state.set(source, { dist: 0, done: false, parent: undefined, pen: view.penalty(source) });
  heap.push(source, h0);
  stats.pushes++;

  const isDone = (id: NodeId) => state.get(id)?.done === true;
  const path = (to: NodeId, cost: number) =>
    buildPath(source, to, cost, parentArcs(source, to, (id) => state.get(id)?.parent).reverse());
  let prunedByCost = false;

  while (heap.size > 0) {
    const u = heap.pop() as NodeId;
    const su = state.get(u) as State;
    if (su.done) continue; // entrada obsoleta (lazy deletion)
    const g = su.dist;
    if (g > maxCost) {
      stats.stopReason = "maxCost";
      break;
    }
    if (u === target) {
      su.done = true;
      paths.push(path(u, g));
      stats.stopReason = "target";
      break;
    }
    if (stats.expanded >= maxExpanded) {
      stats.stopReason = "maxExpanded";
      break;
    }

    let arcs = view.arcs(u);
    if (arcs === undefined) {
      yield recordFetch(stats, frontierRequest(view, u, [heap], isDone, batch));
      arcs = view.arcs(u) ?? EMPTY;
    }
    su.done = true;
    stats.expanded++;
    stats.edgesScanned += arcs.length;
    const visible = visibleArcs(arcs, filter, ctx);

    if (match && (u !== source || opts.includeSource) && match(u, visible)) {
      paths.push(path(u, g));
      if (paths.length >= k) {
        stats.stopReason = "k";
        break;
      }
    }

    // La penalización de u puede no estar fresca si se leyó antes de cargarlo (Postgres).
    const halfPu = view.penalty(u) / 2;
    for (const arc of visible) {
      const v = arc.to;
      let sv = state.get(v);
      if (sv?.done) continue;
      const pv = sv ? sv.pen : view.penalty(v);
      const nd = g + arc.base + halfPu + pv / 2;
      if (nd > maxCost) {
        prunedByCost = true;
        continue;
      }
      if (sv === undefined || nd < sv.dist) {
        let key = nd;
        if (potential) {
          const hv = potential(v);
          if (hv === Infinity) continue; // no puede llegar a ningún objetivo
          key += hv;
        }
        if (sv === undefined) state.set(v, (sv = { dist: nd, done: false, parent: arc, pen: pv }));
        else {
          sv.dist = nd;
          sv.parent = arc;
        }
        heap.push(v, key);
        stats.pushes++;
      }
    }
  }
  if (stats.stopReason === "exhausted") {
    if (prunedByCost) stats.stopReason = "maxCost";
    else if (target !== undefined) stats.stopReason = "unreachable";
  }
  return { paths, stats };
}

// ---------------------------------------------------------------------------
// Multi-objetivo con conjunto de candidatos conocido
// ---------------------------------------------------------------------------

export interface TargetedOptions extends Omit<DijkstraOptions, "target" | "potential"> {
  /** Candidatos explícitos (p. ej. los vecinos de un tema). `match` se sigue aplicando. */
  readonly targets: readonly NodeId[];
  /** Expansiones de la fase hacia atrás. Default: 4·|targets| + 256. */
  readonly backwardBudget?: number;
}

/**
 * k-más-cercanos cuando el conjunto de candidatos es conocido y chico (temas de
 * nicho). Dos fases:
 *
 *  1. Dijkstra multi-origen hacia atrás desde todos los candidatos, acotado a
 *     `backwardBudget` expansiones. Da `db(v) = min_t d(v,t)` exacto dentro del
 *     radio explorado `R`; fuera, `d(v,t) ≥ R` para todo candidato.
 *  2. A* hacia adelante desde el origen con `h(v) = min(db(v), R)`.
 *
 * `h` es mínimo de dos potenciales consistentes (db y la constante R), por lo
 * que es consistente: los candidatos salen del heap en orden de distancia real
 * y el resultado es exacto, igual que Dijkstra simple.
 */
export function* targetedNearest(view: AdjacencyView, source: NodeId, opts: TargetedOptions): SearchGenerator<SearchResult> {
  const filter = opts.filter ?? allowAll;
  const ctx: TraversalContext = { viewer: opts.viewer ?? source };
  const budget = opts.backwardBudget ?? 4 * opts.targets.length + 256;
  const back = yield* boundedReverse(view, opts.targets, budget, filter, ctx, opts.batchSize ?? DEFAULT_BATCH);
  const set = new Set(opts.targets);
  const userMatch = opts.match;
  const res = yield* dijkstra(view, source, {
    viewer: ctx.viewer, filter, batchSize: opts.batchSize, k: opts.k, includeSource: opts.includeSource,
    maxCost: opts.maxCost, maxExpanded: opts.maxExpanded,
    match: (id, arcs) => set.has(id) && (!userMatch || userMatch(id, arcs)),
    potential: (id) => {
      const d = back.dist.get(id);
      return d === undefined || d > back.radius ? back.radius : d;
    },
  });
  res.stats.expanded += back.stats.expanded;
  res.stats.edgesScanned += back.stats.edgesScanned;
  res.stats.pushes += back.stats.pushes;
  res.stats.fetches += back.stats.fetches;
  res.stats.fetchedNodes += back.stats.fetchedNodes;
  return res;
}

function* boundedReverse(
  view: AdjacencyView,
  seeds: readonly NodeId[],
  budget: number,
  filter: EdgeFilter,
  ctx: TraversalContext,
  batch: number,
): SearchGenerator<{ dist: Map<NodeId, number>; radius: number; stats: SearchStats }> {
  const stats = newStats();
  const dist = new Map<NodeId, number>();
  const done = new Set<NodeId>();
  const heap = new MinHeap<NodeId>();
  for (const s of seeds) {
    if (dist.has(s)) continue;
    dist.set(s, 0);
    heap.push(s, 0);
    stats.pushes++;
  }
  const skip = (id: NodeId) => done.has(id);
  while (heap.size > 0 && stats.expanded < budget) {
    const u = heap.pop() as NodeId;
    if (done.has(u)) continue;
    const g = dist.get(u) as number;
    let arcs = view.arcs(u);
    if (arcs === undefined) {
      yield recordFetch(stats, frontierRequest(view, u, [heap], skip, batch));
      arcs = view.arcs(u) ?? EMPTY;
    }
    done.add(u);
    stats.expanded++;
    stats.edgesScanned += arcs.length;
    const halfPu = view.penalty(u) / 2;
    // Hacia atrás: el arco real es v→u, así que el filtro lo ve invertido.
    for (const arc of visibleArcs(arcs, filter, ctx, true)) {
      const v = arc.to;
      if (done.has(v)) continue;
      const nd = g + arc.base + halfPu + view.penalty(v) / 2;
      const old = dist.get(v);
      if (old === undefined || nd < old) {
        dist.set(v, nd);
        heap.push(v, nd);
        stats.pushes++;
      }
    }
  }
  // Todo nodo no asentado está a distancia ≥ tope del heap (o inalcanzable).
  return { dist: filterDone(dist, done), radius: heap.size ? heap.peekKey() : Infinity, stats };
}

function filterDone(dist: Map<NodeId, number>, done: Set<NodeId>): Map<NodeId, number> {
  for (const id of dist.keys()) if (!done.has(id)) dist.delete(id);
  return dist;
}
