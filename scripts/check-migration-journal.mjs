import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const directory = "packages/broker/drizzle";
const journal = `${directory}/meta/_journal.json`;
const { entries } = JSON.parse(readFileSync(journal, "utf8"));
const base = execFileSync("git", ["show", `${process.argv[2]}:${journal}`], { encoding: "utf8" });
const previous = JSON.parse(base).entries;

assert.deepEqual(entries.slice(0, previous.length), previous, "El journal publicado debe conservarse");
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
const filenames = entries.map(({ tag }) => `${tag}.sql`);
assert.deepEqual([...filenames].sort(), files, "Cada SQL debe figurar una vez en el journal");

// Drizzle applies journal entries in timestamp order. The snapshot chain records the schema
// each migration was generated from, including branches whose filenames sort differently.
let previousId = "00000000-0000-0000-0000-000000000000";
const snapshotIds = new Set([previousId]);
for (const [i, { idx, when, tag }] of entries.entries()) {
  assert.equal(idx, i, `Índice incorrecto en ${tag}`);
  assert.ok(Number.isSafeInteger(when) && when > (entries[i - 1]?.when ?? 0), `Timestamp fuera de orden en ${tag}`);
  const prefix = tag.split("_", 1)[0];
  const { id, prevId } = JSON.parse(readFileSync(`${directory}/meta/${prefix}_snapshot.json`, "utf8"));
  assert.ok(typeof id === "string" && id.length && !snapshotIds.has(id), `ID de snapshot inválido o repetido en ${tag}`);
  assert.equal(prevId, previousId, `El snapshot de ${tag} debe continuar el anterior del journal`);
  snapshotIds.add(id);
  previousId = id;
}
