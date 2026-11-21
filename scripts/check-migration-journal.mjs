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
assert.deepEqual(entries.map(({ tag }) => `${tag}.sql`), files, "Cada SQL debe figurar en orden en el journal");
for (const [i, { idx, when }] of entries.entries()) {
  assert.equal(idx, i, `Índice incorrecto en ${files[i]}`);
  assert.ok(Number.isSafeInteger(when) && when > (entries[i - 1]?.when ?? 0), `Timestamp fuera de orden en ${files[i]}`);
}
