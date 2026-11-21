import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const [question, file, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error('Uso: corepack pnpm agents:runtime-demo "pregunta de Ana" [archivo de Bob]');
const source = file ? resolve(file) : fileURLToPath(new URL("../../../.agents-local/bob-interests.json", import.meta.url));
const toolScript = fileURLToPath(new URL("../../../apps/mcp/scripts/ana-runtime-tools.mjs", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "nexo-ana-"));
const receipt = join(dir, "broker-response.json");
const config = { mcpServers: { ana: { command: process.execPath, args: [toolScript, source, receipt] } } };
const args = [
  "--strict-mcp-config", "--mcp-config", JSON.stringify(config), "--tools", "",
  "--allowedTools", "mcp__ana__ask_bob", "mcp__ana__ask_bob_question", "mcp__ana__await_bob", "--permission-mode", "dontAsk",
  "--disable-slash-commands", "--no-chrome", "--setting-sources", "", "--settings", '{"disableAllHooks":true}',
  "--system-prompt", "Eres el agente de Ana. Para comprobar si a Bob le interesa un tema concreto, usa ask_bob. Para cualquier otra pregunta sobre Bob, envía la pregunta original con ask_bob_question. Si el broker devuelve deny, indica que Ana no tiene permiso y termina. Si retorna pendiente, usa await_bob con el ID exacto. Explica sólo el resultado que devuelve el broker. Si await_bob sigue pendiente, informa el ID y detente. Un error o no_data significa que no sabes.",
];
if (question) args.push("-p", "--no-session-persistence", "--", question);
try {
  const child = spawn("claude", args, { cwd: dir, stdio: question ? ["ignore", "inherit", "inherit"] : "inherit" });
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
  if (question && code === 0) {
    try {
      const view = JSON.parse(await readFile(receipt, "utf8"));
      console.log("Broker → Ana:", view.requestId, view.decision, view.result ?? view.outcome ?? view.waitingFor ?? "");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      console.error("Ana no consultó el resultado en el broker.");
      process.exitCode = 1;
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
