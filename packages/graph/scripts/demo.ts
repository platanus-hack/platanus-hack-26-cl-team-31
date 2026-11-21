/**
 * Demo sobre la base de desarrollo sembrada (`pnpm agents:up` / `pnpm agents:seed`).
 *
 *   pnpm with-env pnpm --filter @team-31/graph demo [--sample]
 *
 * Todo corre en una transacción que se revierte al final: proyecta las tablas
 * core a `graph_edges`, consulta y no deja cambios. Con `--sample` agrega
 * algunos intereses de ejemplo (también revertidos), porque el seed de la demo
 * no siembra intereses.
 */
import pg from "pg";
import { explain, matchers, nodeId, topicId, type EdgeFilter, type NodeId } from "../src/index.js";
import { PgGraphIndex } from "../src/pg/index.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL requerida: usa pnpm with-env");
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("BEGIN");
  const { rows: tables } = await db.query("SELECT to_regclass('people') IS NOT NULL AND to_regclass('interests') IS NOT NULL AS ok");
  if (!tables[0]?.ok) throw new Error("Faltan las tablas core: corre `pnpm agents:up` primero.");
  const { rows: people } = await db.query<{ id: string }>("SELECT id FROM people ORDER BY id");
  if (people.length < 2) throw new Error("No hay personas sembradas: corre `pnpm agents:up 3`.");

  if (process.argv.includes("--sample")) {
    const ids = people.map((p) => p.id);
    const sample: [string, string, string][] = [
      [ids[0] as string, "ajedrez", ""],
      [ids[1] as string, "ajedrez", "futbol"],
      [ids[ids.length - 1] as string, "ajedrez", ""],
      [ids[1] as string, "fotografía", ""],
      [ids[ids.length - 1] as string, "fotografía", ""],
    ];
    for (const [p, i, a] of sample) await db.query("INSERT INTO interests VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [p, i, a]);
  }

  const index = new PgGraphIndex(db);
  await index.migrate();
  await index.rebuildFromCore();
  console.log("Proyección:", await index.counts());

  const me = nodeId("person", people[0]?.id as string);
  // Ejemplo de hook: solo aristas públicas. La regla real la define el equipo de permisos.
  const publicOnly: EdgeFilter = (arc) => arc.scope === "";

  console.log(`\nPersonas más cercanas a ${me}:`);
  const near = await index.nearest(me, { match: matchers.ofKind("person"), k: 5 });
  for (const p of near.paths) console.log("  ", explain(p));
  console.log(`   (${near.queries} consultas, ${near.stats.expanded} nodos expandidos)`);

  const { rows: topics } = await db.query<{ interest: string }>("SELECT DISTINCT lower(btrim(interest)) AS interest FROM interests LIMIT 3");
  for (const { interest } of topics) {
    const topic: NodeId = topicId(interest);
    for (const [label, filter] of [["sin filtro", undefined], ["solo público", publicOnly]] as const) {
      const res = await index.interestedIn(me, topic, { k: 3, filter });
      console.log(`\n¿Cómo llego a gente interesada en "${interest}"? (${label}, ${res.queries} consultas)`);
      if (!res.paths.length) console.log("   nadie visible");
      for (const p of res.paths) console.log("  ", explain(p));
    }
  }
} finally {
  await db.query("ROLLBACK").catch(() => undefined);
  await db.end();
}
