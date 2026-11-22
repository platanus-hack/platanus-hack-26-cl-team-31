// Cliente mínimo del stack vivo de Sideband: web (dev-login/dev-token), broker (/v1/owner/*)
// y MCP (tools/call). Sin dependencias: solo node:crypto y fetch.
import { createPrivateKey, randomUUID, sign as signRaw } from "node:crypto";
import { readFileSync } from "node:fs";

export function loadEnv(root) {
  const env = {};
  for (const file of [".env", ".env.local"]) {
    let text;
    try { text = readFileSync(`${root}/${file}`, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      let value = match[2].trim();
      if (/^(['"]).*\1$/s.test(value)) value = value.slice(1, -1);
      env[match[1]] = value;
    }
  }
  return env;
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");

// Replica mintServiceToken({ iss: "web" }) de @team-31/auth/service sin traer jose.
export function mintWebToken(privateJwk, userId) {
  const key = createPrivateKey({ key: privateJwk, format: "jwk" });
  const iat = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "EdDSA" }));
  const payload = b64u(JSON.stringify({
    iss: "web", aud: "broker", sub: userId, iat, exp: iat + 60, jti: randomUUID(),
  }));
  const signature = b64u(signRaw(null, Buffer.from(`${header}.${payload}`), key));
  return `${header}.${payload}.${signature}`;
}

export class HttpError extends Error {
  constructor(where, request, status, body) {
    super(`${where}: HTTP ${status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.where = where; this.request = request; this.status = status; this.body = body;
  }
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

export function createStack(env) {
  const webUrl = (env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  const brokerUrl = (env.BROKER_URL ?? "").replace(/\/$/, "");
  const mcpUrl = env.MCP_RESOURCE_URL ?? "";
  const webKey = JSON.parse(env.WEB_SERVICE_PRIVATE_KEY ?? "null");
  if (!webUrl || !brokerUrl || !mcpUrl || !webKey) {
    throw new Error("Faltan BETTER_AUTH_URL, BROKER_URL, MCP_RESOURCE_URL o WEB_SERVICE_PRIVATE_KEY.");
  }

  async function web(path, body) {
    const request = { method: "POST", url: `${webUrl}${path}`, body };
    const response = await fetch(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", origin: webUrl },
      body: JSON.stringify(body),
    });
    const parsed = await readBody(response);
    if (!response.ok) throw new HttpError(`web ${path}`, request, response.status, parsed);
    return parsed;
  }

  // Rutas del titular en el broker, firmadas con el JWT de servicio `web` del worktree.
  async function owner(userId, method, path, body) {
    const request = { method, url: `${brokerUrl}${path}`, body };
    const response = await fetch(request.url, {
      method,
      headers: {
        authorization: `Bearer ${mintWebToken(webKey, userId)}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await readBody(response);
    if (!response.ok) throw new HttpError(`owner ${method} ${path}`, request, response.status, parsed);
    return parsed;
  }

  // El MCP remoto es stateless: `tools/call` directo con el access token OAuth.
  let nextId = 1;
  // El broker limita a 30 preguntas por minuto y titular. Reintentar es parte del cliente, no
  // del escenario: `sentAt` marca el intento que sí entró, para que la latencia no mida la espera.
  async function callTool(accessToken, name, args, { allowError = false } = {}) {
    const request = { tool: name, args };
    for (let attempt = 0; ; attempt += 1) {
      const sentAt = Date.now();
      const response = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id: nextId++, method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const text = await response.text();
      if (!response.ok && response.status !== 429) throw new HttpError(`mcp ${name}`, request, response.status, text);
      let payload;
      try { payload = JSON.parse(text.includes("data: ") ? text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("") : text); }
      catch { throw new HttpError(`mcp ${name}`, request, response.status, text); }
      if (payload.error) {
        if (response.status === 429 && attempt < 4) { await sleep(15_000); continue; }
        throw new HttpError(`mcp ${name}`, request, response.status, payload.error);
      }
      const result = payload.result ?? {};
      const first = result.content?.find((part) => part.type === "text");
      let data = result.structuredContent;
      if (data === undefined && first) { try { data = JSON.parse(first.text); } catch { data = first.text; } }
      if (result.isError === true) {
        if (data?.error?.code === "rate_limited" && attempt < 4) { await sleep(15_000); continue; }
        // Un `isError` silencioso convertiría una falla en un dato mal formado: se rompe aquí.
        if (!allowError) throw new HttpError(`mcp ${name}`, request, 200, data ?? result);
      }
      return { data, isError: result.isError === true, raw: result, sentAt };
    }
  }

  return { webUrl, brokerUrl, mcpUrl, web, owner, callTool };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
