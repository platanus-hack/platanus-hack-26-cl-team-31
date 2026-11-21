import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describeResult, parseDemoMessage } from "@/lib/demo-chat";
import { identities, isPerson, type Person } from "@/lib/demo";

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

function apiUrl() {
  const url = new URL(process.env.COORDINATION_API_URL ?? "");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== process.env.COORDINATION_PORT) {
    throw new Error("La demo requiere la API del worktree local.");
  }
  return url.origin;
}

async function tokenFor(person: Person) {
  // Next runs from apps/web. These are the worktree's seeded demo credentials.
  const file = resolve(process.cwd(), "../../.agents-local", `${person}.json`);
  const token: unknown = JSON.parse(await readFile(file, "utf8")).mcpServers.coordination.env.AGENT_TOKEN;
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) throw new Error("Credencial de demo inválida.");
  return token;
}

export async function GET(request: Request) {
  if (!isLocal(request)) return json({ ready: false }, 404);
  try {
    const health = await fetch(`${apiUrl()}/health`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) });
    if (!health.ok) return json({ ready: false }, 503);
    await Promise.all(identities.map(tokenFor));
    return json({ ready: true });
  } catch {
    return json({ ready: false }, 503);
  }
}

export async function POST(request: Request) {
  if (!isLocal(request, true)) return json({ text: "Esta demo solo está disponible desde el dashboard local." }, 403);
  let input;
  try { input = await request.json(); }
  catch { return json({ text: "No se pudo leer el mensaje." }, 400); }
  if (!isPerson(input?.person) || typeof input.message !== "string" || !input.message.trim() || input.message.length > 400) {
    return json({ text: "Elige una identidad y escribe un mensaje de hasta 400 caracteres." }, 400);
  }

  const command = parseDemoMessage(input.person, input.message, input.meetingId, input.requestId);
  if (!("input" in command)) return json(command);
  try {
    const response = await fetch(`${apiUrl()}/tools/${command.tool}`, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${await tokenFor(input.person)}`, "Content-Type": "application/json" },
      body: JSON.stringify(command.input),
    });
    if (!response.ok) return json({ text: "La API no pudo ejecutar la consulta. Revisa el entorno local.", tool: command.tool }, 502);
    const data = await response.json();
    return json({ text: describeResult(command, data), tool: command.tool, data });
  } catch {
    return json({ text: "No hay conexión con la API o faltan las identidades. Levanta el entorno con pnpm agents:up 3.", tool: command.tool }, 503);
  }
}
