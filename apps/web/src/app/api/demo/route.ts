import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readHistory, runDemoAgent, selectTools } from "@/lib/demo-chat";
import { asRecord, identities, isPerson, maxMessage, type Person } from "@/lib/demo";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isLocal(request: Request, mutation = false) {
  const port = process.env.WEB_PORT;
  const host = request.headers.get("host");
  return process.env.NODE_ENV === "development" && !!port &&
    (host === `127.0.0.1:${port}` || host === `localhost:${port}`) &&
    (!mutation || request.headers.get("origin") === `http://${host}`);
}

function localUrl(address: string | undefined, port: string | undefined) {
  const url = new URL(address ?? "");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== port) {
    throw new Error("La demo requiere servicios en el worktree local.");
  }
  return url.origin;
}

const apiUrl = () => localUrl(process.env.COORDINATION_API_URL, process.env.COORDINATION_PORT);
const modelUrl = () => localUrl(process.env.DEMO_MODEL_URL, process.env.DEMO_MODEL_PORT);
const modelName = () => process.env.DEMO_MODEL || "qwen3:4b";

async function tokenFor(person: Person) {
  // Next runs from apps/web. These are the worktree's seeded demo credentials.
  const file = resolve(process.cwd(), "../../.agents-local", `${person}.json`);
  const token: unknown = JSON.parse(await readFile(file, "utf8")).mcpServers.coordination.env.AGENT_TOKEN;
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) throw new Error("Credencial de demo inválida.");
  return token;
}

async function checkApi() {
  try {
    const health = await fetch(`${apiUrl()}/health`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) });
    if (!health.ok) return false;
    await Promise.all(identities.map(tokenFor));
    return true;
  } catch { return false; }
}

async function checkModel() {
  try {
    const response = await fetch(`${modelUrl()}/api/tags`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const { models } = await response.json();
    return Array.isArray(models) && models.some(model => model.name === modelName());
  } catch { return false; }
}

export async function GET(request: Request) {
  if (!isLocal(request)) return json({ api: false, model: false }, 404);
  const [api, model] = await Promise.all([checkApi(), checkModel()]);
  return json({ api, model }, api && model ? 200 : 503);
}

export async function POST(request: Request) {
  if (!isLocal(request, true)) return json({ text: "Esta demo solo está disponible desde el dashboard local." }, 403);
  let input: Record<string, unknown> | null;
  try {
    const raw = await request.text();
    if (raw.length > 60_000) return json({ text: "El mensaje es demasiado largo." }, 413);
    input = asRecord(JSON.parse(raw));
  }
  catch { return json({ text: "No se pudo leer el mensaje." }, 400); }
  if (!isPerson(input?.person) || typeof input.message !== "string" || !input.message.trim() || input.message.length > maxMessage) {
    return json({ text: `Elige una identidad y escribe un mensaje de hasta ${maxMessage} caracteres.` }, 400);
  }

  const { person, message } = input;
  let backend: string;
  let headers: HeadersInit;
  let tools: ReturnType<typeof selectTools>;
  try {
    backend = apiUrl();
    headers = { Authorization: `Bearer ${await tokenFor(person)}`, "Content-Type": "application/json" };
    const catalog = await fetch(`${backend}/tools`, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000), headers,
    });
    if (!catalog.ok) throw new Error("Catálogo no disponible.");
    tools = selectTools(await catalog.json());
  } catch {
    return json({ text: "No hay conexión con la API o faltan las identidades. Levanta el entorno con pnpm agents:up 3.", error: "api" }, 503);
  }

  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
  const reply = await runDemoAgent({
    person, message, history: readHistory(input.history), meetingId: input.meetingId, requestId: input.requestId, tools,
    async ask(messages, tools) {
      const response = await fetch(`${modelUrl()}/api/chat`, {
        method: "POST", cache: "no-store", redirect: "error", signal: deadline,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName(), messages, tools, stream: false, think: false, keep_alive: "15m",
          options: { temperature: 0.1, num_ctx: 8192, num_predict: 450 },
        }),
      });
      if (!response.ok) throw new Error("Ollama no disponible.");
      return (await response.json()).message;
    },
    async invoke(tool, args) {
      const response = await fetch(`${backend}/tools/${tool}`, {
        method: "POST", cache: "no-store", redirect: "error", headers,
        signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]),
        body: JSON.stringify(args),
      });
      if (!response.ok) return { error: response.status === 400 ? "invalid_input" : "unavailable" };
      return asRecord(await response.json()) ?? { error: "unavailable" };
    },
  });
  return json(reply, reply.error ? 503 : 200);
}
