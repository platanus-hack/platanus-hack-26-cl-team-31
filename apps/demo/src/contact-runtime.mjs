import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { claudeEnv } from "./contact-broker.mjs";

const run = promisify(execFile);

// The wake receiver calls this binding only after finding the authorized request in the contact's inbox.
export async function askContactOwner(interest, source, root) {
  const toolScript = join(root, "apps/demo/src/contact-interest-tool.mjs");
  const dir = await mkdtemp(join(tmpdir(), "sideband-contact-"));
  const receipt = join(dir, "observation.json");
  try {
    const config = { mcpServers: { owner: { command: process.execPath, args: [toolScript, source, interest, receipt] } } };
    const invocation = run("claude", [
      "-p", "--no-session-persistence", "--no-chrome", "--disable-slash-commands",
      "--setting-sources", "", "--settings", '{"disableAllHooks":true}',
      "--strict-mcp-config", "--mcp-config", JSON.stringify(config),
      "--tools", "", "--allowedTools", "mcp__owner__check_interest", "--permission-mode", "dontAsk",
      "--output-format", "text", "--system-prompt",
      "Eres el agente del contacto. Para responder esta consulta usa mcp__owner__check_interest. Devuelve literalmente el valor JSON de la herramienta, sin Markdown. Nunca infieras una respuesta.",
      "--", "Resuelve la solicitud de interés autorizada en mi bandeja.",
    ], { cwd: dir, env: claudeEnv(), timeout: 90_000, maxBuffer: 256_000 });
    invocation.child.stdin.end();
    const { stdout } = await invocation;
    let observation;
    try {
      observation = JSON.parse(await readFile(receipt, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      throw new Error("Claude no obtuvo un dato de la herramienta autorizada. Revisa el login y la fuente del contacto.");
    }
    const answer = JSON.parse(stdout.trim());
    if (!isDeepStrictEqual(answer, observation)) throw new Error("La respuesta no coincide con la lectura autorizada.");
    return answer;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
