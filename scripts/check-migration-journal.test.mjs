import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const check = fileURLToPath(new URL("./check-migration-journal.mjs", import.meta.url));

test("verifica la cadena completa aunque el orden publicado difiera del alfabético", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "sideband-journal-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const directory = join(repo, "packages/broker/drizzle");
  const meta = join(directory, "meta");
  mkdirSync(meta, { recursive: true });
  const entries = [];
  function append(tag, prevId) {
    const id = randomUUID();
    entries.push({ tag, idx: entries.length, when: entries.length + 1 });
    writeFileSync(join(directory, tag + ".sql"), "SELECT 1;");
    writeFileSync(join(meta, tag.split("_", 1)[0] + "_snapshot.json"), JSON.stringify({ id, prevId }));
    return id;
  }
  const save = () => writeFileSync(join(meta, "_journal.json"), JSON.stringify({ entries }));
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  const publish = () => {
    save();
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.org", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  };
  const run = () => spawnSync(process.execPath, [check, "HEAD"], { cwd: repo, encoding: "utf8" });

  git("init", "-q");
  const first = append("0201_message_turns", "00000000-0000-0000-0000-000000000000");
  const last = append("0014_custom_tags", first);
  publish();
  assert.equal(run().status, 0);

  append("0017_new", last);
  save();
  assert.equal(run().status, 0);
  writeFileSync(join(meta, "0017_snapshot.json"), JSON.stringify({ id: randomUUID(), prevId: first }));
  assert.match(run().stderr, /debe continuar el anterior/);
  publish();
  assert.match(run().stderr, /debe continuar el anterior/);

  const id = randomUUID();
  writeFileSync(join(meta, "0017_snapshot.json"), JSON.stringify({ id, prevId: last }));
  entries.push({ tag: "0017_collision", idx: 3, when: 4 });
  writeFileSync(join(directory, "0017_collision.sql"), "SELECT 2;");
  save();
  assert.match(run().stderr, /snapshot inválido o repetido/);
});
