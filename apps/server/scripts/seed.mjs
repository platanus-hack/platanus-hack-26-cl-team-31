import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { fixtureArgs, outsider } from "../../../scripts/coordination-fixture.mjs";

async function readOrCreateToken(path) {
  try {
    const config = JSON.parse(await readFile(path, "utf8"));
    const token = config.mcpServers.coordination.env.AGENT_TOKEN;
    if (!token) throw new Error(`Credencial inválida en ${path}`);
    return token;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return randomBytes(32).toString("hex");
  }
}

async function seedPerson(db, { id, membership, busySlots = [] }, token) {
  const hash = createHash("sha256").update(token).digest("hex");
  const inserted = await db.query(
    "INSERT INTO people(id, token_hash) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [id, hash]);
  if (!inserted.rowCount) {
    const existing = await db.query("SELECT 1 FROM people WHERE id=$1 AND token_hash=$2", [id, hash]);
    if (!existing.rowCount) throw new Error(`Usa el directorio original con la credencial de ${id}.`);
    return;
  }

  if (membership) {
    await db.query("INSERT INTO memberships(person_id, group_id, can_ask, can_share) VALUES ($1,$2,$3,$4)",
      [id, membership.group, membership.canAsk, membership.canShare]);
  }
  for (const slot of busySlots) {
    const end = new Date(Date.parse(slot.start) + slot.minutes * 60_000);
    await db.query("INSERT INTO busy_slots(person_id,starts_at,ends_at,title) VALUES ($1,$2,$3,$4)",
      [id, slot.start, end, slot.title]);
  }
}

const { people, configDir } = fixtureArgs(process.argv.slice(2));
const { DATABASE_URL, COORDINATION_API_URL } = process.env;
if (!DATABASE_URL || !COORDINATION_API_URL) throw new Error("Ejecuta el seed con pnpm with-env.");
const adapter = fileURLToPath(new URL("../../mcp/dist/index.js", import.meta.url));
await mkdir(configDir, { recursive: true, mode: 0o700 });
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('coordination.demo.seed'))");
  for (const person of [...people, outsider]) {
    const path = join(configDir, `${person.id}.json`);
    const token = await readOrCreateToken(path);
    await seedPerson(db, person, token);
    const config = { mcpServers: { coordination: {
      command: process.execPath, args: [adapter], env: { COORDINATION_API_URL, AGENT_TOKEN: token },
    } } };
    // Atomic replacement keeps each file valid even if initialization is interrupted.
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    await rename(temp, path);
  }
  await db.query("COMMIT");
  console.log(`${people.length} participantes + ${outsider.id}. Configuraciones MCP en ${configDir}`);
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
