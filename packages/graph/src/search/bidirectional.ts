import { MinHeap } from "../heap.js";
import { flip, type Arc, type NodeId } from "../model.js";
import {
  allowAll,
  arcWeight,
  newStats,
  type AdjacencyView,
  type SearchGenerator,
  type SearchOptions,
} from "../view.js";
import { buildPath, DEFAULT_BATCH, EMPTY, frontierRequest, parentArcs, recordFetch, visibleArcs } from "./common.js";
import type { SearchResult } from "./dijkstra.js";

interface Side {
  readonly dist: Map<NodeId, number>;
  readonly parent: Map<NodeId, Arc>;
  readonly settled: Set<NodeId>;
  readonly heap: MinHeap<NodeId>;
  readonly reversed: boolean;
}

function side(root: NodeId, reversed: boolean): Side {
  const heap = new MinHeap<NodeId>();
  heap.push(root, 0);
  return { dist: new Map([[root, 0]]), parent: new Map(), settled: new Set(), heap, reversed };
}

/**
 * Dijkstra bidireccional punto a punto. Como los pesos son simétricos, la
 * búsqueda hacia atrás usa las mismas listas de adyacencia. Se expande siempre
 * el lado con menor clave en el tope y se para cuando
 * `top(forward) + top(backward) >= mejor camino encontrado`.
 */
export function* bidirectional(
  view: AdjacencyView,
  source: NodeId,
  target: NodeId,
  opts: SearchOptions = {},
): SearchGenerator<SearchResult> {
  const stats = newStats();
  stats.pushes = 2;
  const maxCost = opts.maxCost ?? Infinity;
  const maxExpanded = opts.maxExpanded ?? Infinity;
  const filter = opts.filter ?? allowAll;
  const ctx = { viewer: opts.viewer ?? source };
  const batch = opts.batchSize ?? DEFAULT_BATCH;

  if (source === target) {
    stats.stopReason = "target";
    return { paths: [buildPath(source, target, 0, [])], stats };
  }

  const fwd = side(source, false);
  const bwd = side(target, true);
  let best = Infinity;
  let meet: NodeId | undefined;
  const skip = (id: NodeId) => fwd.settled.has(id) && bwd.settled.has(id);

  for (;;) {
    const tf = fwd.heap.peekKey();
    const tb = bwd.heap.peekKey();
    if (tf === Infinity && tb === Infinity) {
      stats.stopReason = meet ? "target" : "unreachable";
      break;
    }
    if (tf + tb >= best) {
      stats.stopReason = "target";
      break;
    }
    if (tf + tb > maxCost) {
      stats.stopReason = "maxCost";
      break;
    }
    if (stats.expanded >= maxExpanded) {
      stats.stopReason = "maxExpanded";
      break;
    }
    const cur = tf <= tb ? fwd : bwd;
    const other = cur === fwd ? bwd : fwd;
    const u = cur.heap.pop() as NodeId;
    if (cur.settled.has(u)) continue;
    const g = cur.dist.get(u) as number;

    let arcs = view.arcs(u);
    if (arcs === undefined) {
      yield recordFetch(stats, frontierRequest(view, u, [cur.heap, other.heap], skip, batch));
      arcs = view.arcs(u) ?? EMPTY;
    }
    cur.settled.add(u);
    stats.expanded++;
    stats.edgesScanned += arcs.length;

    for (const arc of visibleArcs(arcs, filter, ctx, cur.reversed)) {
      const v = arc.to;
      if (cur.settled.has(v)) continue;
      const nd = g + arcWeight(view, arc);
      if (nd > maxCost) continue;
      const old = cur.dist.get(v);
      if (old === undefined || nd < old) {
        cur.dist.set(v, nd);
        cur.parent.set(v, arc);
        cur.heap.push(v, nd);
        stats.pushes++;
      }
      const dv = other.dist.get(v);
      if (dv !== undefined && nd + dv < best) {
        best = nd + dv;
        meet = v;
      }
    }
  }

  if (meet === undefined || best > maxCost) {
    if (stats.stopReason === "target") stats.stopReason = "unreachable";
    return { paths: [], stats };
  }
  const head = parentArcs(source, meet, (id) => fwd.parent.get(id)).reverse();
  // La mitad trasera se guardó con aristas orientadas target→meet; se invierten.
  const tail = parentArcs(target, meet, (id) => bwd.parent.get(id)).map(flip);
  return { paths: [buildPath(source, target, best, head.concat(tail))], stats };
}
