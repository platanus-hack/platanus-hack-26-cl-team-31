import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { adapter, fixtureArgs, group, minutes, slots } from "../../../scripts/coordination-fixture.mjs";

const { people, configDir } = fixtureArgs(process.argv.slice(2));
const { DATABASE_URL, COORDINATION_API_URL } = process.env;
if (!DATABASE_URL || !COORDINATION_API_URL) throw new Error("Ejecuta el seed con pnpm with-env.");
await mkdir(configDir, { recursive: true, mode: 0o700 });
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  // Serialize seed runs sharing the same database and local credentials.
  await db.query("SELECT pg_advisory_xact_lock(hashtext('coordination.demo.seed'))");
  for (const person of [...people, "eva"]) {
    const path = join(configDir, `${person}.json`);
    let token;
    try {
      const config = JSON.parse(await readFile(path, "utf8"));
      token = config.mcpServers.coordination.env.AGENT_TOKEN;
      if (!token) throw new Error(`Credencial inválida en ${path}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      token = randomBytes(32).toString("hex");
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const inserted = await db.query(
      "INSERT INTO people(id, token_hash) VALUES($1,$2) ON CONFLICT (id) DO NOTHING",
      [person, tokenHash],
    );
    if (!inserted.rowCount) {
      const verified = await db.query("SELECT 1 FROM people WHERE id=$1 AND token_hash=$2", [person, tokenHash]);
      if (!verified.rowCount) throw new Error(`Usa el directorio original con la credencial de ${person}.`);
    } else if (person !== "eva") {
      await db.query(
        "INSERT INTO memberships(person_id, group_id, can_ask, can_share) VALUES ($1,$2,true,true)",
        [person, group],
      );
      if (person === "bob") {
        const end = new Date(Date.parse(slots[0]) + minutes * 60_000);
        await db.query("INSERT INTO busy_slots(person_id,starts_at,ends_at,title) VALUES ($1,$2,$3,$4)",
          [person, slots[0], end, "Evento privado ficticio"]);
      }
    }

    const config = { mcpServers: { coordination: {
      command: process.execPath, args: [adapter], env: { COORDINATION_API_URL, AGENT_TOKEN: token },
    } } };
    // Atomic replacement keeps each file valid even if initialization is interrupted.
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    await rename(temp, path);
  }
  await db.query("COMMIT");
  console.log(`${people.length} participantes + eva. Configuraciones MCP en ${configDir}`);
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
