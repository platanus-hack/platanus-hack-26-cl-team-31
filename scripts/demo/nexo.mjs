import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

import { createFixtures, init, readState, reset, saveState, seed } from "./fixtures.mjs";
import { rehearse } from "./rehearse.mjs";

async function start({ db, web }) {
  const build = spawn("pnpm", ["build", "--filter", "./packages/*"], { stdio: "inherit" });
  assert.equal((await once(build, "exit"))[0], 0, "Falló la compilación de los paquetes compartidos.");

  const env = {
    ...process.env, DATABASE_URL: db.href, MCP_DEV_AUTH: "0", WAKE_ALLOW_INSECURE: "1",
    REQUEST_TTL_SECONDS: "75", WAKE_RETRY_DELAYS_MS: "0,0", AGENT_TOKEN: "",
    BROKER_HOST: web.hostname, MCP_HOST: web.hostname, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
    AUTH_ISSUER: new URL("/api/auth", web).href, AUTH_JWKS_URL: new URL("/api/auth/jwks", web).href,
  };
  const commands = [
    ["exec", "turbo", "run", "dev", "--filter", "@team-31/broker-service", "--filter", "@team-31/mcp"],
    ["--filter", "@team-31/web", "exec", "next", "dev", "--hostname", web.hostname, "--port", web.port],
  ];
  const children = commands.map((args) => spawn("pnpm", args, { detached: true, stdio: "inherit", env }));
  const stop = () => {
    for (const child of children) {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const exits = children.map((child) => once(child, "exit"));
  try {
    const [code, signal] = await Promise.race(exits);
    process.exitCode = code ?? (signal === "SIGTERM" ? 0 : 1);
  } finally {
    stop();
    await Promise.allSettled(exits);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

async function main() {
  const [command, mode, ...extra] = process.argv.slice(2);
  assert(["init", "stack", "seed", "run", "reset"].includes(command) &&
    (mode === undefined || (mode === "--present" && command === "run")) && !extra.length,
  "Uso: pnpm with-env node scripts/demo/nexo.mjs {init|stack|seed|run [--present]|reset}");

  const fixture = await readState();
  if (command === "reset" && !fixture) {
    console.log("No hay datos de la demo por eliminar.");
    return;
  }
  if (command !== "init") {
    assert(fixture, "Ejecuta init para preparar la base descartable.");
    assert.equal(fixture.web, new URL(process.env.BETTER_AUTH_URL).origin, "Usa el mismo worktree de la demo.");
    assert.equal(fixture.port, process.env.POSTGRES_PORT, "Usa el mismo Postgres de la demo.");
  }
  const isolated = ["stack", "seed", "run"].includes(command);
  const fixtures = await createFixtures({ run: isolated ? fixture.run : undefined, withSessions: ["seed", "run"].includes(command) });
  try {
    switch (command) {
      case "init": return await init(fixtures);
      case "stack":
        // Release the advisory lock so seed and run can access the demo DB.
        await fixtures.close();
        return await start(fixtures);
      case "seed": return await seed(fixtures, fixture);
      case "reset": return await reset(fixtures, fixture);
      case "run":
        assert(fixture.actors, "Ejecuta seed para preparar las cuentas y las reglas.");
        assert(!fixture.started, "Ejecuta reset, init y seed para preparar otro ensayo.");
        if (mode === "--present") assert(process.stdin.isTTY, "Usa una terminal interactiva para presentar la demo.");
        await saveState({ ...fixture, started: true });
        return await rehearse(fixtures, fixture, mode === "--present");
    }
  } finally {
    if (command !== "stack") await fixtures.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`Demo interrumpida. ${error.message}`);
  process.exitCode = 1;
}
