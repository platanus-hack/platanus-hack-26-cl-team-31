import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryGraphIndex } from "../memory.js";
import type { GraphMutation, NodeId } from "../model.js";
import { interestMutation, membershipMutation, projectCore } from "../projection.js";
import { matchers, nearestSearch } from "../search/api.js";
import { syntheticGraph } from "../synthetic.js";
import type { EdgeFilter } from "../view.js";
import { PgGraphIndex } from "./index.js";
import { runPgSearch } from "./query.js";

const url = process.env.TEST_DATABASE_URL;
const CORE_SQL = new URL("../../../../apps/server/sql/01-core.sql", import.meta.url);

// Usa la base de tests (`app_test`) en un schema propio y desechable.
describe.skipIf(!url)("PgGraphIndex (Postgres)", () => {
  const db = new pg.Client({ connectionString: url });
  const schema = `graph_test_${process.pid}`;
  const index = new PgGraphIndex(db);
  const g = syntheticGraph({ people: 400, seed: 11 });
  const mem = new MemoryGraphIndex(g.mutations);
  // Los tests que modifican el grafo lo marcan; los que comparan contra `g` lo recargan antes,
  // así ninguno depende del orden en que corren.
  let dirty = false;

  async function baseGraph() {
    if (!dirty) return;
    await index.truncate();
    await index.bulkLoad(g.mutations);
    dirty = false;
  }

  async function pgSnapshot(): Promise<string[]> {
    const { rows } = await db.query(
      "SELECT e.src, e.dst, e.kind, e.scope, e.base, e.attrs, n.degree FROM graph_edges e JOIN graph_nodes n ON n.id = e.src",
    );
    return rows.map((r) => `${r.src} ${r.dst} ${r.kind} ${r.scope} ${r.base} ${JSON.stringify(r.attrs)} ${r.degree}`).sort();
  }
  function memSnapshot(m: MemoryGraphIndex): string[] {
    const out: string[] = [];
    for (const id of m.nodeIds())
      for (const a of m.arcs(id)) out.push(`${a.from} ${a.to} ${a.kind} ${a.scope} ${a.base} ${JSON.stringify(a.attrs ?? null)} ${m.degree(id)}`);
    return out.sort();
  }

  beforeAll(async () => {
    await db.connect();
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await index.migrate();
    await index.bulkLoad(g.mutations);
  });
  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  it("bulkLoad = índice en memoria", async () => {
    await baseGraph();
    expect(await pgSnapshot()).toEqual(memSnapshot(mem));
  });

  it("nearest y path dan los mismos costos que en memoria, con pocas consultas", async () => {
    await baseGraph();
    const filter: EdgeFilter = (arc) => arc.scope === "";
    for (const s of g.people.slice(0, 8)) {
      for (const f of [undefined, filter]) {
        const opts = { match: matchers.ofKind("person"), k: 15, filter: f };
        const a = await index.nearest(s, opts);
        const b = mem.nearest(s, opts);
        expect(a.paths.map((p) => p.cost.toFixed(9))).toEqual(b.paths.map((p) => p.cost.toFixed(9)));
        expect(a.queries).toBe(a.stats.fetches);
        expect(a.queries).toBeLessThan(a.stats.expanded);
      }
      const t = g.people[399] as NodeId;
      for (const algorithm of ["dijkstra", "bidirectional"] as const) {
        const a = await index.path(s, t, { algorithm });
        const b = mem.path(s, t, { algorithm });
        expect(a.paths[0]?.cost).toBeCloseTo(b.paths[0]?.cost ?? NaN, 9);
      }
    }
  });

  it("permite filtrar los grupos por el atributo canAsk de la membresía", async () => {
    dirty = true;
    await index.apply([
      membershipMutation({ person_id: "ana", group_id: "lectura", can_ask: true, can_share: false }),
      membershipMutation({ person_id: "ana", group_id: "cine", can_ask: false, can_share: true }),
    ]);

    const result = await runPgSearch(db, (view) => nearestSearch(view, "person:ana", {
      match: matchers.ofKind("group"),
      filter: (arc) => arc.attrs?.canAsk === true,
    }));
    expect(result.paths.map((path) => path.target)).toEqual(["group:lectura"]);
  });

  it("interestedIn carga adyacencias y cuenta las consultas de cada búsqueda", async () => {
    await baseGraph();
    const filter: EdgeFilter = (arc) => arc.scope === "";
    const opts = { k: 5, filter };
    const source = "person:p0";
    const topic = "topic:t0";
    const expected = mem.interestedIn(source, topic, opts).paths.map((path) => path.cost);
    expect(expected).toHaveLength(opts.k);

    const searches = await Promise.all([index.interestedIn(source, topic, opts), index.interestedIn(source, topic, opts)]);
    for (const result of searches) {
      expect(result.paths.map((path) => path.cost)).toEqual(expected);
      expect(result.queries).toBe(result.stats.fetches);
      expect(result.rowsFetched).toBeGreaterThan(0);
    }
    expect(searches[0].rowsFetched).toBe(searches[1].rowsFetched);
  });

  it("apply incremental = memoria", async () => {
    await baseGraph();
    dirty = true;
    const local = new MemoryGraphIndex(g.mutations);
    const changes: GraphMutation[] = [
      membershipMutation({ person_id: "p1", group_id: "nuevo", can_ask: true, can_share: false }),
      membershipMutation({ person_id: "p2", group_id: "nuevo", can_ask: false, can_share: true }),
      interestMutation({ person_id: "p2", interest: "Rareza", audience: "nuevo" }),
      membershipMutation({ person_id: "p1", group_id: "nuevo", can_ask: true, can_share: true }),
      { op: "removeEdge", a: "person:p2", b: "group:nuevo", kind: "member_of" },
      { op: "removeNode", id: g.topics[0] as NodeId },
      { op: "removeNode", id: "person:p3" },
    ];
    await index.apply(changes);
    local.apply(changes);
    expect(await pgSnapshot()).toEqual(memSnapshot(local));
  });

  it("rebuildFromCore = proyección en TS", async () => {
    dirty = true;
    await db.query(await readFile(CORE_SQL, "utf8"));
    const core = syntheticGraph({ people: 120, seed: 5, vaults: false }).core;
    await db.query("INSERT INTO people(id, token_hash) SELECT id, 'h' || id FROM unnest($1::text[]) id", [core.people.map((p) => p.id)]);
    for (const m of core.memberships)
      await db.query("INSERT INTO memberships VALUES ($1,$2,$3,$4)", [m.person_id, m.group_id, m.can_ask, m.can_share]);
    for (const i of core.interests)
      await db.query("INSERT INTO interests VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [i.person_id, i.interest, i.audience]);
    await index.rebuildFromCore();
    expect(await pgSnapshot()).toEqual(memSnapshot(new MemoryGraphIndex(projectCore(core))));
  });
});
