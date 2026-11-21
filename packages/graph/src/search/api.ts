import { kindOf, type EdgeKind, type NodeId, type NodeKind } from "../model.js";
import { allowAll, type AdjacencyView, type Path, type SearchGenerator, type SearchOptions } from "../view.js";
import { bidirectional } from "./bidirectional.js";
import { EMPTY, recordFetch, visibleArcs } from "./common.js";
import { dijkstra, targetedNearest, type NodeMatcher, type SearchResult } from "./dijkstra.js";
import type { LandmarkTable } from "./landmarks.js";

export type PathAlgorithm = "dijkstra" | "bidirectional" | "alt";

export interface PathOptions extends SearchOptions {
  readonly algorithm?: PathAlgorithm;
  /** Requerido para "alt". Si falta o está desactualizada, cae a bidireccional. */
  readonly landmarks?: LandmarkTable;
  /** Si la tabla fue construida con otra versión del índice, no es segura. */
  readonly landmarksStale?: boolean;
}

export function pathSearch(view: AdjacencyView, source: NodeId, target: NodeId, opts: PathOptions = {}): SearchGenerator<SearchResult> {
  switch (opts.algorithm ?? "bidirectional") {
    case "dijkstra":
      return dijkstra(view, source, { ...opts, target });
    case "bidirectional":
      return bidirectional(view, source, target, opts);
    case "alt":
      return altSearch(view, source, target, opts);
  }
}

function* altSearch(view: AdjacencyView, source: NodeId, target: NodeId, opts: PathOptions): SearchGenerator<SearchResult> {
  if (!opts.landmarks || opts.landmarksStale) {
    const res = yield* bidirectional(view, source, target, opts);
    res.stats.fallback = opts.landmarks ? "landmarks desactualizados → bidireccional" : "sin landmarks → bidireccional";
    return res;
  }
  return yield* dijkstra(view, source, { ...opts, target, potential: opts.landmarks.potentialTo(target) });
}

export interface NearestOptions extends SearchOptions {
  readonly match: NodeMatcher;
  readonly k?: number;
  readonly includeSource?: boolean;
}

/** Consulta principal del producto: los k nodos más cercanos que cumplen `match`. */
export function nearestSearch(view: AdjacencyView, source: NodeId, opts: NearestOptions): SearchGenerator<SearchResult> {
  return dijkstra(view, source, opts);
}

export interface InterestedOptions extends SearchOptions {
  readonly k?: number;
  /**
   * "forward": Dijkstra desde el origen hasta encontrar k interesados.
   * "targeted": los candidatos se leen del tema (1 fetch) y se usa
   *   `targetedNearest` (búsqueda hacia atrás acotada + A*).
   * "auto" (default): targeted si el tema tiene ≤ `targetedMax` (256) interesados;
   *   con más, hacia adelante encuentra k interesados casi de inmediato.
   */
  readonly strategy?: "auto" | "forward" | "targeted";
  readonly targetedMax?: number;
  readonly backwardBudget?: number;
}

/**
 * "¿Cómo llego a gente interesada en T?": las k personas más cercanas con una
 * arista `interested_in` visible hacia `topic`.
 */
export function* interestedInSearch(
  view: AdjacencyView,
  source: NodeId,
  topic: NodeId,
  opts: InterestedOptions = {},
): SearchGenerator<SearchResult> {
  const match = matchers.interestedIn(topic);
  const strategy = opts.strategy ?? "auto";
  if (strategy === "forward") return yield* dijkstra(view, source, { ...opts, match });
  let fetched: { ids: readonly NodeId[] } | undefined;
  let arcs = view.arcs(topic);
  if (arcs === undefined) {
    fetched = { ids: [topic] };
    yield fetched;
    arcs = view.arcs(topic) ?? EMPTY;
  }
  const max = opts.targetedMax ?? 256;
  let res: SearchResult;
  if (strategy === "auto" && arcs.length > max) {
    res = yield* dijkstra(view, source, { ...opts, match });
  } else {
    const ctx = { viewer: opts.viewer ?? source };
    // Las aristas del tema van tema→persona; el filtro las ve como persona→tema.
    const targets = visibleArcs(arcs, opts.filter ?? allowAll, ctx, true)
      .filter((a) => a.kind === "interested_in" && kindOf(a.to) === "person" && a.to !== source)
      .map((a) => a.to);
    res = yield* targetedNearest(view, source, { ...opts, match, targets });
  }
  if (fetched) recordFetch(res.stats, fetched);
  const filter = opts.filter ?? allowAll;
  const ctx = { viewer: opts.viewer ?? source };
  const paths = res.paths.map((p) => ({
    ...p,
    evidence: visibleArcs(view.arcs(p.target) ?? EMPTY, filter, ctx).filter((a) => a.kind === "interested_in" && a.to === topic),
  }));
  return { ...res, paths };
}

/** Predicados listos para `nearest`. */
export const matchers = {
  ofKind:
    (kind: NodeKind): NodeMatcher =>
    (id) =>
      kindOf(id) === kind,
  inSet:
    (ids: ReadonlySet<NodeId>): NodeMatcher =>
    (id) =>
      ids.has(id),
  /** Personas con una arista visible `interested_in` hacia `topic`. */
  interestedIn:
    (topic: NodeId): NodeMatcher =>
    (id, arcs) =>
      kindOf(id) === "person" && arcs.some((a) => a.kind === "interested_in" && a.to === topic),
  /** Nodos de tipo `kind` con una arista visible de tipo `edge` hacia `to`. */
  linkedTo:
    (kind: NodeKind, edge: EdgeKind, to: NodeId): NodeMatcher =>
    (id, arcs) =>
      kindOf(id) === kind && arcs.some((a) => a.kind === edge && a.to === to),
  and:
    (...ms: NodeMatcher[]): NodeMatcher =>
    (id, arcs) =>
      ms.every((m) => m(id, arcs)),
};

const VERB: Record<EdgeKind, string> = {
  member_of: "es miembro de",
  interested_in: "le interesa",
  owns: "es dueño de",
  about: "trata sobre",
  related_to: "se relaciona con",
  knows: "conoce a",
};
const VERB_REV: Record<EdgeKind, string> = {
  member_of: "tiene como miembro a",
  interested_in: "le interesa a",
  owns: "pertenece a",
  about: "es tema de",
  related_to: "se relaciona con",
  knows: "conoce a",
};
const FORWARD_FROM: Record<EdgeKind, NodeKind[]> = {
  member_of: ["person"],
  interested_in: ["person"],
  owns: ["person"],
  about: ["vault"],
  related_to: ["vault", "topic"],
  knows: ["person"],
};

/** Explicación legible de un camino, p. ej. para que el agente la cite. */
export function explain(path: Path): string {
  const parts = [path.source as string];
  for (const arc of path.arcs) {
    const forward = FORWARD_FROM[arc.kind].includes(kindOf(arc.from));
    const verb = forward ? VERB[arc.kind] : VERB_REV[arc.kind];
    const scope = arc.scope ? ` [solo ${arc.scope}]` : "";
    parts.push(`—${verb}${scope}→ ${arc.to}`);
  }
  for (const arc of path.evidence ?? []) {
    const scope = arc.scope ? ` [solo ${arc.scope}]` : "";
    parts.push(`(${VERB[arc.kind]}${scope} ${arc.to})`);
  }
  return `${parts.join(" ")}  (costo ${path.cost.toFixed(2)})`;
}
