// Carga masiva del mundo en una sola transacción (INSERT ... SELECT unnest(arrays)), sin un
// round-trip por fila. Los tokens son aleatorios (no forman parte del mundo determinista) y
// se escriben fuera del repo con permisos 0600.
//   pnpm with-env node apps/scale/src/seed.mjs <escenario> [--agents N] [--reset] [--out DIR]
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { generateWorld, loadScenario } from "./world.mjs";

const SQL = new URL("../../server/sql/", import.meta.url);
const sha256 = (/** @type {string} */ text) => createHash("sha256").update(text).digest("hex");
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

/** Mismo procedimiento que apps/server/scripts/schema.mjs (idempotente). @param {pg.ClientBase} db */
export async function applySchema(db) {
  await db.query("BEGIN");
  try {
    await db.query("SELECT pg_advisory_xact_lock(313126)");
    for (const file of (await readdir(SQL)).filter(f => f.endsWith(".sql")).sort()) {
      await db.query(await readFile(new URL(file, SQL), "utf8"));
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

/**
 * @param {pg.ClientBase} db
 * @param {import("./world.mjs").World} world
 * @param {{reset?: boolean}} [options]
 * @returns {Promise<Map<string, string>>} id → token
 */
export async function seedWorld(db, world, { reset = false } = {}) {
  const tokens = new Map(world.people.map(id => [id, randomBytes(24).toString("base64url")]));
  const col = (/** @type {any[]} */ rows, /** @type {(row: any) => unknown} */ get) => rows.map(get);
  await db.query("BEGIN");
  try {
    if (reset) {
      // CASCADE: también limpia tablas nuevas que referencien a people (contactos, perfiles…).
      await db.query(`TRUNCATE meeting_participants, meetings, availability_requests, interests,
        busy_slots, memberships, people CASCADE`);
    }
    // Los triggers de FK por fila son ~80% del costo con 100k+ filas. Si el rol puede, se omiten
    // dentro de esta transacción y las FK se validan al final con un anti-join por tabla.
    const superuser = (await db.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0]?.rolsuper;
    if (superuser) await db.query("SET LOCAL session_replication_role = replica");
    await db.query("INSERT INTO people(id, token_hash) SELECT * FROM unnest($1::text[], $2::text[])",
      [world.people, world.people.map(id => sha256(/** @type {string} */ (tokens.get(id))))]);
    const m = world.memberships;
    await db.query(`INSERT INTO memberships(person_id, group_id, can_ask, can_share)
      SELECT * FROM unnest($1::text[], $2::text[], $3::boolean[], $4::boolean[])`,
    [col(m, x => x.person), col(m, x => x.group), col(m, x => x.canAsk), col(m, x => x.canShare)]);
    const b = world.busy;
    await db.query(`INSERT INTO busy_slots(person_id, starts_at, ends_at, title)
      SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::timestamptz[], $4::text[])`,
    [col(b, x => x.person), col(b, x => iso(x.start)), col(b, x => iso(x.end)), col(b, x => x.title)]);
    const i = world.interests;
    await db.query(`INSERT INTO interests(person_id, interest, audience)
      SELECT * FROM unnest($1::text[], $2::text[], $3::text[])`,
    [col(i, x => x.person), col(i, x => x.interest), col(i, x => x.audience)]);
    if (superuser) {
      const { rows } = await db.query(`SELECT
        (SELECT count(*) FROM memberships t WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = t.person_id))
      + (SELECT count(*) FROM busy_slots t WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = t.person_id))
      + (SELECT count(*) FROM interests t WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = t.person_id)) AS orphans`);
      if (Number(rows[0].orphans)) throw new Error(`Siembra inválida: ${rows[0].orphans} filas sin persona`);
      await db.query("SET LOCAL session_replication_role = origin");
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    if (/** @type {any} */ (error).code === "23505") {
      throw new Error("Ya existen identidades del escenario en la base. Usa --reset (borra TODA la base de coordinación).");
    }
    throw error;
  }
  return tokens;
}

/** @param {Map<string, string>} tokens @param {string} [dir] */
export async function writeTokens(tokens, dir) {
  const target = dir ?? await mkdtemp(join(tmpdir(), "team31-scale-"));
  const path = join(target, "tokens.json");
  await writeFile(path, JSON.stringify(Object.fromEntries(tokens)) + "\n", { mode: 0o600 });
  return path;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const flag = (/** @type {string} */ name) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? undefined : args[i + 1];
  };
  const name = args.find(a => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.match(/^--(agents|out)$/));
  if (!name || !process.env.DATABASE_URL) throw new Error("Uso: pnpm with-env node apps/scale/src/seed.mjs <escenario> [--agents N] [--reset] [--out DIR]");
  const agents = flag("agents");
  const world = generateWorld(loadScenario(name, agents ? { agents: Number(agents) } : {}));
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const started = performance.now();
    await applySchema(db);
    const tokens = await seedWorld(db, world, { reset: args.includes("--reset") });
    const ms = Math.round(performance.now() - started);
    console.log(`Mundo ${world.hash}: ${world.people.length} personas, ${world.memberships.length} membresías, ` +
      `${world.busy.length} bloques, ${world.interests.length} intereses en ${ms} ms. Tokens: ${await writeTokens(tokens, flag("out"))}`);
  } finally { await db.end(); }
}
