import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { promisify } from "node:util";
import pg from "pg";
import { LocalPart } from "@team-31/protocol";

const run = promisify(execFile);
const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Load only Ana's saved demo contacts and their individual grants. The owner tools read the interests.
async function loadContacts(root, bobFile, janeFile) {
  if (!process.env.DATABASE_URL) throw new Error("Ejecuta agents:runtime-demo con pnpm with-env.");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query(`
      SELECT p.person_id AS id, p.display_name AS name, c.owner_id = ANY(p.interest_readers) AS allowed
      FROM contacts c JOIN demo_profiles p ON p.person_id = c.contact_id
      WHERE c.owner_id = $1 ORDER BY p.person_id`, ["ana"]);
    const overrides = new Map([["bob", bobFile && resolve(bobFile)], ["jane", janeFile && resolve(janeFile)]]);
    return rows.map(({ id, name, allowed }) => ({
      id, name, allowsInterest: allowed, source: resolve(root, overrides.get(id) ?? `.agents-local/${LocalPart.parse(id)}-interests.json`),
    }));
  } finally {
    await db.end();
  }
}
export async function checkContactRuntime(root = cliRoot) {
  await Promise.all([
    loadContacts(root), run("claude", ["--version"], { timeout: 8000 }),
    access(join(root, "apps/broker/dist/index.js")),
  ]);
}

export async function runContactSession(question, { root = cliRoot, bobFile, janeFile, signal } = {}) {
  const contacts = await loadContacts(root, bobFile, janeFile);
  const toolScript = join(root, "apps/demo/src/ana-runtime-tools.mjs");
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
  try {
    if (!question) {
      const child = spawn("claude", args, { cwd: dir, stdio: "inherit" });
      const [code] = await once(child, "exit");
      if (code !== 0) throw new Error("La sesión interactiva de Ana terminó con un error.");
      return;
    }
    args.push("-p", "--no-session-persistence", "--", question);
    const job = run("claude", args, { cwd: dir, signal, maxBuffer: 512_000 });
    job.child.stdin.end();
    const { stdout } = await job;
    const traces = [];
    const requests = new Map();
    const events = (await readFile(receipt, "utf8")).trimEnd().split("\n");
    for (const line of events) {
      const event = JSON.parse(line);
      if (event.contacts) traces.push({ tool: "list_contacts", input: {}, data: { contacts: event.contacts } });
      if (event.requestId) requests.set(event.requestId, event);
    }
    for (const view of requests.values()) {
      const { to, requestId, decision, result, outcome, waitingFor } = view;
      traces.push({ tool: view.tool, input: { contact: to }, data: { to, requestId, decision, result, outcome, waitingFor } });
    }
    return { text: stdout.trim(), traces };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
