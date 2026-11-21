import { readFile } from "node:fs/promises";
import { BASE_COST, HUB_PENALTY, hubPenalty } from "../cost.js";
import { kindOf, NODE_KINDS, type Arc, type EdgeKind, type GraphMutation, type NodeId } from "../model.js";
import {
  interestedInSearch,
  nearestSearch,
  pathSearch,
  type InterestedOptions,
  type NearestOptions,
  type PathOptions,
} from "../search/api.js";
import type { SearchResult } from "../search/dijkstra.js";
import { runAsync, type AdjacencyView } from "../view.js";

/** Lo mínimo que se necesita de `pg.Client` / `pg.Pool` / `pg.PoolClient`. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export const GRAPH_SQL_URL = new URL("../../sql/graph.sql", import.meta.url);

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

/**
 * Índice respaldado por Postgres (`graph_nodes` + `graph_edges`). Las búsquedas
 * solo leen el vecindario explorado: ~una consulta indexada por capa.
 *
 * Las mutaciones no abren transacción propia: corren en la conexión recibida
 * para que el llamador las agrupe con el cambio de origen (p. ej. el INSERT en
 * `memberships`).
 */
export class PgGraphIndex {
  constructor(private readonly db: Queryable) {}

  static async schemaSql(): Promise<string> {
    return readFile(GRAPH_SQL_URL, "utf8");
  }

  async migrate(): Promise<void> {
    await this.db.query(await PgGraphIndex.schemaSql());
  }

  async truncate(): Promise<void> {
    await this.db.query("TRUNCATE graph_edges, graph_nodes");
  }

  // ---- Búsquedas ------------------------------------------------------------

  async nearest(source: NodeId, opts: NearestOptions): Promise<PgSearchResult> {
    const view = new PgSearchView(this.db);
    const res = await runAsync(nearestSearch(view, source, opts), view.load);
    return { ...res, queries: view.queries, rowsFetched: view.rows };
  }

  async interestedIn(source: NodeId, topic: NodeId, opts: InterestedOptions = {}): Promise<PgSearchResult> {
    const view = new PgSearchView(this.db);
    const res = await runAsync(interestedInSearch(view, source, topic, opts), view.load);
    return { ...res, queries: view.queries, rowsFetched: view.rows };
  }

  /** ALT no está disponible aquí (requiere tabla de landmarks); cae a bidireccional. */
  async path(source: NodeId, target: NodeId, opts: PathOptions = {}): Promise<PgSearchResult> {
    const view = new PgSearchView(this.db);
    const res = await runAsync(pathSearch(view, source, target, opts), view.load);
    return { ...res, queries: view.queries, rowsFetched: view.rows };
  }

  // ---- Mutaciones incrementales ------------------------------------------

  async apply(mutations: Iterable<GraphMutation>): Promise<void> {
    for (const m of mutations) {
      switch (m.op) {
        case "upsertNode":
          await this.db.query(
            `INSERT INTO graph_nodes(id, kind, label) VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET label = COALESCE(EXCLUDED.label, graph_nodes.label)`,
            [m.id, kindOf(m.id), m.label ?? null],
          );
          break;
        case "removeNode":
          await this.db.query(
            `WITH out AS (DELETE FROM graph_edges WHERE src = $1 RETURNING dst, kind, scope),
                  back AS (DELETE FROM graph_edges e USING out
                           WHERE e.src = out.dst AND e.dst = $1 AND e.kind = out.kind AND e.scope = out.scope
                           RETURNING e.src)
             UPDATE graph_nodes n SET degree = n.degree - c.cnt
             FROM (SELECT src, count(*)::int AS cnt FROM back GROUP BY src) c WHERE n.id = c.src`,
            [m.id],
          );
          await this.db.query("DELETE FROM graph_nodes WHERE id = $1", [m.id]);
          break;
        case "upsertEdge": {
          if (m.a === m.b) throw new Error(`Arista reflexiva no permitida: ${m.a}`);
          await this.db.query(
            `INSERT INTO graph_nodes(id, kind) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING`,
            [m.a, kindOf(m.a), m.b, kindOf(m.b)],
          );
          await this.db.query(
            `WITH ins AS (
               INSERT INTO graph_edges(src, dst, kind, scope, base, attrs)
               VALUES ($1, $2, $3, $4, $5, $6), ($2, $1, $3, $4, $5, $6)
               ON CONFLICT (src, dst, kind, scope) DO UPDATE SET base = EXCLUDED.base, attrs = EXCLUDED.attrs
               RETURNING src, (xmax = 0) AS inserted)
             UPDATE graph_nodes n SET degree = n.degree + 1 FROM ins WHERE ins.inserted AND n.id = ins.src`,
            [m.a, m.b, m.kind, m.scope ?? "", m.base, m.attrs ? JSON.stringify(m.attrs) : null],
          );
          break;
        }
        case "removeEdge":
          await this.db.query(
            `WITH del AS (
               DELETE FROM graph_edges
               WHERE ((src = $1 AND dst = $2) OR (src = $2 AND dst = $1)) AND kind = $3 AND scope = $4
               RETURNING src)
             UPDATE graph_nodes n SET degree = n.degree - 1 FROM del WHERE n.id = del.src`,
            [m.a, m.b, m.kind, m.scope ?? ""],
          );
          break;
      }
    }
  }

  /**
   * Carga masiva (benchmarks / primera sincronización): inserta por lotes con
   * `unnest` y recalcula grados al final. Solo soporta upserts.
   */
  async bulkLoad(mutations: Iterable<GraphMutation>, chunk = 20_000): Promise<void> {
    const nodes = new Map<NodeId, string | null>();
    const edges = new Map<string, [NodeId, NodeId, EdgeKind, string, number, string | null]>();
    for (const m of mutations) {
      if (m.op === "upsertNode") nodes.set(m.id, m.label ?? nodes.get(m.id) ?? null);
      else if (m.op === "upsertEdge") {
        const scope = m.scope ?? "";
        const attrs = m.attrs ? JSON.stringify(m.attrs) : null;
        if (!nodes.has(m.a)) nodes.set(m.a, null);
        if (!nodes.has(m.b)) nodes.set(m.b, null);
        edges.set(`${m.a}\u0000${m.b}\u0000${m.kind}\u0000${scope}`, [m.a, m.b, m.kind, scope, m.base, attrs]);
        edges.set(`${m.b}\u0000${m.a}\u0000${m.kind}\u0000${scope}`, [m.b, m.a, m.kind, scope, m.base, attrs]);
      } else throw new Error(`bulkLoad no soporta ${m.op}; usa apply()`);
    }
    const nodeRows = [...nodes];
    for (let i = 0; i < nodeRows.length; i += chunk) {
      const part = nodeRows.slice(i, i + chunk);
      await this.db.query(
        `INSERT INTO graph_nodes(id, kind, label)
         SELECT id, split_part(id, ':', 1), label FROM unnest($1::text[], $2::text[]) AS t(id, label)
         ON CONFLICT (id) DO UPDATE SET label = COALESCE(EXCLUDED.label, graph_nodes.label)`,
        [part.map((r) => r[0]), part.map((r) => r[1])],
      );
    }
    const edgeRows = [...edges.values()];
    for (let i = 0; i < edgeRows.length; i += chunk) {
      const part = edgeRows.slice(i, i + chunk);
      await this.db.query(
        `INSERT INTO graph_edges(src, dst, kind, scope, base, attrs)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::float8[], $6::jsonb[])
         ON CONFLICT (src, dst, kind, scope) DO UPDATE SET base = EXCLUDED.base, attrs = EXCLUDED.attrs`,
        [0, 1, 2, 3, 4, 5].map((c) => part.map((r) => r[c])),
      );
    }
    await this.recomputeDegrees();
  }

  /** Reconstrucción completa desde `people`/`memberships`/`interests`. */
  async rebuildFromCore(): Promise<void> {
    await this.truncate();
    await this.db.query(`
      INSERT INTO graph_nodes(id, kind)
      SELECT 'person:' || id, 'person' FROM people
      UNION SELECT 'group:' || group_id, 'group' FROM memberships
      UNION SELECT 'topic:' || lower(btrim(interest)), 'topic' FROM interests`);
    await this.db.query(
      `INSERT INTO graph_edges(src, dst, kind, scope, base, attrs)
       SELECT p, g, 'member_of', '', $1::float8, a FROM (
         SELECT 'person:' || person_id AS p, 'group:' || group_id AS g,
                jsonb_build_object('canAsk', can_ask, 'canShare', can_share) AS a FROM memberships) m
       UNION ALL
       SELECT g, p, 'member_of', '', $1::float8, a FROM (
         SELECT 'person:' || person_id AS p, 'group:' || group_id AS g,
                jsonb_build_object('canAsk', can_ask, 'canShare', can_share) AS a FROM memberships) m
       UNION ALL
       SELECT p, t, 'interested_in', audience, CASE WHEN audience = '' THEN $2::float8 ELSE $3::float8 END, NULL FROM (
         SELECT 'person:' || person_id AS p, 'topic:' || lower(btrim(interest)) AS t, audience FROM interests) i
       UNION ALL
       SELECT t, p, 'interested_in', audience, CASE WHEN audience = '' THEN $2::float8 ELSE $3::float8 END, NULL FROM (
         SELECT 'person:' || person_id AS p, 'topic:' || lower(btrim(interest)) AS t, audience FROM interests) i
       ON CONFLICT DO NOTHING`,
      [BASE_COST.member_of, BASE_COST.interestedInPublic, BASE_COST.interestedInScoped],
    );
    await this.recomputeDegrees();
  }

  async recomputeDegrees(): Promise<void> {
    await this.db.query(`
      UPDATE graph_nodes n SET degree = coalesce(c.cnt, 0)
      FROM graph_nodes n2 LEFT JOIN (SELECT src, count(*)::int AS cnt FROM graph_edges GROUP BY src) c ON c.src = n2.id
      WHERE n.id = n2.id AND n.degree IS DISTINCT FROM coalesce(c.cnt, 0)`);
    await this.compact();
  }

  /**
   * Reordena `graph_edges` físicamente por `src` para que la adyacencia de un
   * nodo quede en pocas páginas (sin esto, ~1 página por fila). Toma un lock
   * exclusivo: es para cargas completas o mantenimiento, no para el camino
   * caliente. Las inserciones incrementales posteriores degradan el orden.
   */
  async compact(): Promise<void> {
    await this.db.query("CLUSTER graph_edges USING graph_edges_pkey");
    await this.db.query("ANALYZE graph_nodes, graph_edges");
  }

  async counts(): Promise<{ nodes: number; arcs: number }> {
    const { rows } = await this.db.query(
      "SELECT (SELECT count(*) FROM graph_nodes)::int AS nodes, (SELECT count(*) FROM graph_edges)::int AS arcs",
    );
    return rows[0] as { nodes: number; arcs: number };
  }
}
