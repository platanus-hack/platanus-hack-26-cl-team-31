import { HUB_PENALTY, hubPenalty } from "../cost.js";
import { kindOf, NODE_KINDS, type Arc, type EdgeKind, type NodeId } from "../model.js";
import type { SearchResult } from "../search/dijkstra.js";
import { runAsync, type AdjacencyView, type SearchGenerator } from "../view.js";

/** Lo mínimo que se necesita de `pg.Client` / `pg.Pool` / `pg.PoolClient`. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export interface PgSearchResult extends SearchResult {
  /** Consultas SQL emitidas por la búsqueda. */
  readonly queries: number;
  readonly rowsFetched: number;
}

interface NeighborRow {
  src: NodeId;
  dst: NodeId;
  kind: EdgeKind;
  scope: string;
  base: number;
  attrs: Record<string, unknown> | null;
  dst_degree: number;
}

/**
 * Vecinos de un lote de nodos: un range scan por el PK (`src`, …). El grado del
 * vecino se lee con un lookup por PK solo si su tipo tiene penalización de hub
 * (las personas no tienen: así las filas tema→persona, la mayoría, no pagan el
 * lookup). Un JOIN normal hace que el planner elija hash join + seq scan de
 * `graph_nodes` en lotes grandes.
 */
const NEIGHBORS_SQL = `
  SELECT e.src, e.dst, e.kind, e.scope, e.base, e.attrs,
         CASE WHEN split_part(e.dst, ':', 1) = ANY($2::text[]) THEN 0
              ELSE (SELECT n.degree FROM graph_nodes n WHERE n.id = e.dst) END AS dst_degree
  FROM graph_edges e
  WHERE e.src = ANY($1::text[])`;

const NO_PENALTY_KINDS = NODE_KINDS.filter((k) => HUB_PENALTY[k] === 0);

/**
 * Vista perezosa de una búsqueda: un caché de adyacencias que se llena con una
 * consulta por lote de frontera. Vive lo que dura la búsqueda.
 */
class PgSearchView implements AdjacencyView {
  private readonly adjacency = new Map<NodeId, Arc[]>();
  private readonly penalties = new Map<NodeId, number>();
  queries = 0;
  rows = 0;

  constructor(private readonly db: Queryable) {}

  arcs(id: NodeId): readonly Arc[] | undefined {
    return this.adjacency.get(id);
  }

  penalty(id: NodeId): number {
    return this.penalties.get(id) ?? 0;
  }

  readonly load = async (ids: readonly NodeId[]): Promise<void> => {
    const todo = ids.filter((id) => !this.adjacency.has(id));
    if (!todo.length) return;
    const { rows } = await this.db.query(NEIGHBORS_SQL, [todo, NO_PENALTY_KINDS]);
    this.queries++;
    this.rows += rows.length;
    for (const id of todo) this.adjacency.set(id, []);
    for (const r of rows as NeighborRow[]) {
      const arc: Arc = r.attrs
        ? { from: r.src, to: r.dst, kind: r.kind, scope: r.scope, base: r.base, attrs: r.attrs }
        : { from: r.src, to: r.dst, kind: r.kind, scope: r.scope, base: r.base };
      (this.adjacency.get(r.src) as Arc[]).push(arc);
      if (!this.penalties.has(r.dst)) this.penalties.set(r.dst, hubPenalty(kindOf(r.dst), r.dst_degree));
    }
    // El grado de un nodo expandido es exactamente su número de filas.
    for (const id of todo) this.penalties.set(id, hubPenalty(kindOf(id), (this.adjacency.get(id) as Arc[]).length));
  };
}

export async function runPgSearch(
  db: Queryable,
  search: (view: AdjacencyView) => SearchGenerator<SearchResult>,
): Promise<PgSearchResult> {
  const view = new PgSearchView(db);
  const result = await runAsync(search(view), view.load);
  return { ...result, queries: view.queries, rowsFetched: view.rows };
}
