import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import pg from "pg";
import { LocalPart } from "@team-31/protocol";

const [question, bobFile, janeFile, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error('Uso: corepack pnpm agents:runtime-demo "pregunta de Ana" [archivo de Bob] [archivo de Jane]');
function source(file, id) {
  return file ? resolve(file) : fileURLToPath(new URL(`../../../.agents-local/${id}-interests.json`, import.meta.url));
}
// Load only Ana's saved demo contacts and their individual grants. The owner tools read the interests.
if (!process.env.DATABASE_URL) throw new Error("Ejecuta agents:runtime-demo con pnpm with-env.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let contacts;
try {
  const { rows } = await db.query(`
    SELECT p.person_id AS id, p.display_name AS name, c.owner_id = ANY(p.interest_readers) AS allowed
    FROM contacts c JOIN demo_profiles p ON p.person_id = c.contact_id
    WHERE c.owner_id = $1 ORDER BY p.person_id`, ["ana"]);
  const overrides = new Map([["bob", bobFile], ["jane", janeFile]]);
  contacts = rows.map(({ id, name, allowed }) => ({
    id, name, allowsInterest: allowed, source: source(overrides.get(id), LocalPart.parse(id)),
  }));
} finally {
  await db.end();
}
const toolScript = fileURLToPath(new URL("./ana-runtime-tools.mjs", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "nexo-ana-"));
const receipt = join(dir, "broker-responses.jsonl");
const config = { mcpServers: { ana: {
  command: process.execPath, args: [toolScript, JSON.stringify(contacts), receipt],
} } };
const args = [
  "--strict-mcp-config", "--mcp-config", JSON.stringify(config), "--tools", "",
  "--allowedTools", "mcp__ana__list_contacts", "mcp__ana__ask_contact", "mcp__ana__await_contact", "--permission-mode", "dontAsk",
  "--disable-slash-commands", "--no-chrome", "--setting-sources", "", "--settings", '{"disableAllHooks":true}',
  "--system-prompt", [
    "Eres el agente de Ana. Usa list_contacts para encontrar la dirección de cada persona mencionada.",
    "Usa ask_contact una vez por destinatario. Para comprobar un interés concreto envía {interest}; para otras preguntas envía {text} con la pregunta original.",
    "Si Ana añade «¿y qué tal otra persona?», consulta el mismo tema para esa persona. Si falta un contacto, indícalo.",
    "Si pregunta si a alguien le interesa un tema sin nombrar destinatarios, lista la agenda y consulta ese interés a cada contacto una vez.",
    "Incluye todos los contactos en la búsqueda, aunque ya encuentres una coincidencia. Si la agenda está vacía, dilo.",
    "Sólo un matches:true confirma el interés. Distingue matches:false de las consultas sin respuesta o permiso.",
    "Para cada solicitud pendiente usa await_contact con su ID. Asocia cada respuesta a su contacto.",
    "Un deny indica falta de permiso; no_data o un error significa que no sabes. Continúa con los demás contactos.",
    "Si await_contact sigue pendiente, informa el ID. Explica sólo lo observado.",
  ].join(" "),
];
if (question) args.push("-p", "--no-session-persistence", "--", question);
try {
  const child = spawn("claude", args, { cwd: dir, stdio: question ? ["ignore", "inherit", "inherit"] : "inherit" });
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
  if (question && code === 0) {
    try {
      const events = (await readFile(receipt, "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
      const requests = new Map();
      for (const event of events) {
        if (event.requestId) requests.set(event.requestId, event);
      }
      for (const view of requests.values()) {
        console.log("Broker → Ana:", view.to, view.requestId, view.decision, view.result ?? view.outcome ?? view.waitingFor ?? "");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      console.error("Ana no consultó sus herramientas.");
      process.exitCode = 1;
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
