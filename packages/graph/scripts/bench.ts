/**
 * Benchmarks de @team-31/graph.
 *
 *   pnpm --filter @team-31/graph bench                      # memoria, 1k/10k/100k
 *   pnpm --filter @team-31/graph bench --sizes 1000,10000
 *   pnpm with-env pnpm --filter @team-31/graph bench:pg     # + Postgres (DATABASE_URL, schema graph_bench)
 */
import { performance } from "node:perf_hooks";
import pg from "pg";
import {
  matchers,
  MemoryGraphIndex,
  rng,
  syntheticGraph,
  type NodeId,
  type PathAlgorithm,
  type SearchResult,
} from "../src/index.js";
import { PgGraphIndex } from "../src/pg/index.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : def;
};
const sizes = opt("sizes", "1000,10000,100000").split(",").map(Number);
const pgSizes = opt("pg-sizes", "1000,10000,100000").split(",").map(Number);
const Q = Number(opt("queries", "200"));
const LANDMARKS = Number(opt("landmarks", "8"));

interface Agg {
  ms: number[];
  expanded: number[];
  scanned: number[];
  queries: number[];
  rows: number[];
}
const agg = (): Agg => ({ ms: [], expanded: [], scanned: [], queries: [], rows: [] });
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN;
};
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const int = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : "—");

function record(a: Agg, ms: number, r: SearchResult, queries = 0, rows = 0) {
  a.ms.push(ms);
  a.expanded.push(r.stats.expanded);
  a.scanned.push(r.stats.edgesScanned);
  a.queries.push(queries);
  a.rows.push(rows);
}

function table(title: string, head: string[], rows: string[][]) {
  console.log(`\n### ${title}\n`);
  console.log(`| ${head.join(" | ")} |`);
  console.log(`| ${head.map(() => "---").join(" | ")} |`);
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
}

function pick<T>(xs: readonly T[], r: () => number): T {
  return xs[Math.floor(r() * xs.length)] as T;
}

const summary: string[][] = [];
const nearestRows: string[][] = [];
const buildRows: string[][] = [];
const pgRows: string[][] = [];

for (const N of sizes) {
  let t0 = performance.now();
  const g = syntheticGraph({ people: N, seed: 2026 });
  const genMs = performance.now() - t0;
  t0 = performance.now();
  const index = new MemoryGraphIndex(g.mutations);
  const buildMs = performance.now() - t0;
  t0 = performance.now();
  const lmBase = index.buildLandmarks(LANDMARKS, "base");
  const lmBaseMs = performance.now() - t0;
  t0 = performance.now();
  const lmEff = index.buildLandmarks(LANDMARKS, "effective");
  const lmEffMs = performance.now() - t0;

  // Pares aleatorios persona→persona.
  const r = rng(N);
  const pairs = Array.from({ length: Q }, () => [pick(g.people, r), pick(g.people, r)] as [NodeId, NodeId]);
  const algos: [string, PathAlgorithm, typeof lmEff | undefined][] = [
    ["dijkstra", "dijkstra", undefined],
    ["bidirectional", "bidirectional", undefined],
    [`ALT base (${LANDMARKS})`, "alt", lmBase],
    [`ALT effective (${LANDMARKS})`, "alt", lmEff],
  ];
  const results = new Map<string, Agg>(algos.map(([n]) => [n, agg()]));
  for (let i = 0; i < 20; i++) index.path(...(pairs[i % pairs.length] as [NodeId, NodeId])); // warm-up
  for (const [s, t] of pairs) {
    let ref: number | undefined;
    for (const [name, algorithm, landmarks] of algos) {
      const t1 = performance.now();
      const res = index.path(s, t, { algorithm, landmarks });
      record(results.get(name) as Agg, performance.now() - t1, res);
      const cost = res.paths[0]?.cost ?? Infinity;
      if (ref === undefined) ref = cost;
      else if (Math.abs(cost - ref) > 1e-9 && !(cost === Infinity && ref === Infinity))
        throw new Error(`${name} difiere: ${cost} vs ${ref} (${s}→${t})`);
    }
  }
  for (const [name, a] of results)
    summary.push([int(N), name, int(mean(a.expanded)), int(mean(a.scanned)), f(mean(a.ms), 3), f(pct(a.ms, 0.5), 3), f(pct(a.ms, 0.95), 3)]);

  // Consulta principal: k personas más cercanas interesadas en el tema T.
  const byPopularity = [...g.topics].sort((a, b) => index.degree(b) - index.degree(a));
  const buckets: [string, NodeId[]][] = [
    ["tema popular (top 1%)", byPopularity.slice(0, Math.max(1, Math.floor(byPopularity.length / 100)))],
    ["tema nicho (cola)", byPopularity.slice(Math.floor(byPopularity.length / 2))],
  ];
  for (const [label, topics] of buckets) {
    const queries = Array.from({ length: Q }, () => [pick(g.people, r), pick(topics, r)] as [NodeId, NodeId]);
    const ref: number[][] = [];
    for (const strategy of ["forward", "targeted", "auto"] as const) {
      const a = agg();
      let found = 0;
      queries.forEach(([s, topic], i) => {
        const t1 = performance.now();
        const res = index.interestedIn(s, topic, { strategy, k: 10, maxExpanded: 50_000 });
        record(a, performance.now() - t1, res);
        found += res.paths.length;
        const costs = res.paths.map((p) => p.cost);
        if (strategy === "forward") ref[i] = costs;
        else if (costs.some((c, j) => Math.abs(c - (ref[i]?.[j] ?? NaN)) > 1e-9)) throw new Error(`${strategy} difiere en ${s} ${topic}`);
      });
      nearestRows.push([int(N), `k=10 personas · ${label} · ${strategy}`, f(found / Q, 1), int(mean(a.expanded)), int(mean(a.scanned)), f(mean(a.ms), 3), f(pct(a.ms, 0.95), 3)]);
    }
  }
  if (g.vaults.length) {
    const a = agg();
    let found = 0;
    for (let i = 0; i < Q; i++) {
      const s = pick(g.vaults, r);
      const t1 = performance.now();
      const res = index.nearest(s, { match: matchers.ofKind("vault"), k: 5, maxExpanded: 50_000 });
      record(a, performance.now() - t1, res);
      found += res.paths.length;
    }
    nearestRows.push([int(N), "k=5 vaults relacionados", f(found / Q, 1), int(mean(a.expanded)), int(mean(a.scanned)), f(mean(a.ms), 3), f(pct(a.ms, 0.95), 3)]);
  }

  // Actualizaciones incrementales.
  const upd: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const p = pick(g.people, r).slice("person:".length);
    const grp = `g${Math.floor(r() * 50)}`;
    const t1 = performance.now();
    index.apply([
      i % 2
        ? { op: "removeEdge", a: `person:${p}`, b: `group:${grp}`, kind: "member_of" }
        : { op: "upsertEdge", a: `person:${p}`, b: `group:${grp}`, kind: "member_of", base: 1 },
    ]);
    upd.push(performance.now() - t1);
  }
  buildRows.push([
    int(N),
    int(index.nodeCount),
    int(index.edgeCount),
    f(genMs, 0),
    f(buildMs, 0),
    `${f(lmBaseMs, 0)} / ${f(lmEffMs, 0)}`,
    f(lmEff.bytes / 1e6, 1),
    f(mean(upd) * 1000, 1),
  ]);
  console.error(`✓ memoria N=${N}`);

  if (flag("pg") && pgSizes.includes(N)) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL requerida: usa pnpm with-env");
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
      await db.query("CREATE SCHEMA IF NOT EXISTS graph_bench; SET search_path TO graph_bench");
      const store = new PgGraphIndex(db);
      await db.query("DROP TABLE IF EXISTS graph_edges, graph_nodes");
      await store.migrate();
      t0 = performance.now();
      await store.bulkLoad(g.mutations);
      const loadMs = performance.now() - t0;
      const pq = Math.min(Q, N > 10_000 ? 30 : 100);
      const runs: [string, (s: NodeId, i: number) => Promise<{ res: SearchResult; queries: number; rows: number }>][] = [];
      const topics = buckets[1]?.[1] as NodeId[];
      for (const batchSize of N <= 10_000 ? [1, 32, 128] : [32, 128]) {
        runs.push([
          `interesados k=10 tema nicho · forward · batch ${batchSize}`,
          async (s, i) => {
            const topic = topics[i % topics.length] as NodeId;
            const res = await store.interestedIn(s, topic, { strategy: "forward", k: 10, maxExpanded: 5_000, batchSize });
            return { res, queries: res.queries, rows: res.rowsFetched };
          },
        ]);
      }
      for (const batchSize of [32, 128]) {
        runs.push([
          `interesados k=10 tema nicho · targeted · batch ${batchSize}`,
          async (s, i) => {
            const topic = topics[i % topics.length] as NodeId;
            const res = await store.interestedIn(s, topic, { strategy: "targeted", k: 10, maxExpanded: 5_000, batchSize });
            return { res, queries: res.queries, rows: res.rowsFetched };
          },
        ]);
      }
      runs.push([
        "vaults relacionados k=5 · batch 32",
        async (_s, i) => {
          const res = await store.nearest(g.vaults[i % g.vaults.length] as NodeId, { match: matchers.ofKind("vault"), k: 5 });
          return { res, queries: res.queries, rows: res.rowsFetched };
        },
      ]);
      for (const algorithm of ["dijkstra", "bidirectional"] as const) {
        runs.push([
          `path ${algorithm} · batch 32`,
          async (s, i) => {
            const res = await store.path(s, pairs[i]?.[1] as NodeId, { algorithm });
            return { res, queries: res.queries, rows: res.rowsFetched };
          },
        ]);
      }
      for (const [name, run] of runs) {
        const a = agg();
        await run(pairs[0]?.[0] as NodeId, 0); // warm-up
        for (let i = 0; i < pq; i++) {
          const t1 = performance.now();
          const { res, queries, rows } = await run(pairs[i]?.[0] as NodeId, i);
          record(a, performance.now() - t1, res, queries, rows);
        }
        pgRows.push([int(N), name, int(mean(a.expanded)), f(mean(a.queries), 1), int(mean(a.rows)), f(mean(a.ms), 2), f(pct(a.ms, 0.95), 2)]);
      }
      // Mutación incremental en Postgres (incluye actualizar grados).
      const ms: number[] = [];
      for (let i = 0; i < 200; i++) {
        const p = pick(g.people, r);
        const t1 = performance.now();
        await store.apply([
          i % 2
            ? { op: "removeEdge", a: p, b: "group:bench", kind: "member_of" }
            : { op: "upsertEdge", a: p, b: "group:bench", kind: "member_of", base: 1 },
        ]);
        ms.push(performance.now() - t1);
      }
      pgRows.push([int(N), `bulkLoad ${f(loadMs / 1000, 1)} s · apply() ${f(mean(ms), 2)} ms/mutación`, "", "", "", "", ""]);
    } finally {
      await db.end();
    }
    console.error(`✓ postgres N=${N}`);
  }
}

table("Construcción e incrementalidad (memoria)", ["personas", "nodos", "relaciones", "generar ms", "indexar ms", "landmarks ms (base / eff)", "landmarks MB", "update µs"], buildRows);
table(`Punto a punto persona→persona (${Q} pares, memoria)`, ["personas", "algoritmo", "expandidos", "aristas", "media ms", "p50 ms", "p95 ms"], summary);
table(`Más cercanos (${Q} consultas, memoria)`, ["personas", "consulta", "encontrados", "expandidos", "aristas", "media ms", "p95 ms"], nearestRows);
if (pgRows.length)
  table("Postgres (graph_bench, DATABASE_URL)", ["personas", "búsqueda", "expandidos", "consultas", "filas", "media ms", "p95 ms"], pgRows);
