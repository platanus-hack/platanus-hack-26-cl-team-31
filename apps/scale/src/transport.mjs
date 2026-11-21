// Dos caminos hacia la API: HTTP directo (throughput) o un adaptador MCP stdio real por agente.
import http from "node:http";
import { fileURLToPath } from "node:url";

/** @typedef {{status: number, text: string, body: any, ms: number, error?: string}} Response */

/** @param {string} base @param {number} maxSockets */
export function httpTransport(base, maxSockets) {
  const url = new URL(base);
  // timeout < keepAliveTimeout del servidor (5 s) para no reutilizar sockets que el servidor ya cerró.
  const agent = new http.Agent({ keepAlive: true, maxSockets, timeout: 4000 });
  /**
   * @param {{path: string, token?: string, body?: unknown, raw?: string, method?: string, reqId?: string}} req
   * @returns {Promise<Response>}
   */
  function call({ path, token, body, raw, method, reqId }) {
    const data = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const started = performance.now();
    return new Promise(resolve => {
      const done = (/** @type {Omit<Response, "ms">} */ r) => resolve({ ...r, ms: performance.now() - started });
      const request = http.request({
        agent, host: url.hostname, port: url.port, path, method: method ?? (data === undefined ? "GET" : "POST"),
        headers: {
          "content-type": "application/json",
          ...(token && { authorization: `Bearer ${token}` }),
          ...(reqId && { "x-request-id": reqId }),
        },
      }, response => {
        /** @type {Buffer[]} */ const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = undefined; }
          done({ status: response.statusCode ?? 0, text, body: parsed });
        });
        response.on("error", error => done({ status: 0, text: "", body: undefined, error: error.message }));
      });
      request.setTimeout(30_000, () => request.destroy(new Error("timeout")));
      request.on("error", (/** @type {any} */ error) => done({ status: 0, text: "", body: undefined, error: error.code ?? error.message }));
      request.end(data);
    });
  }
  return { call, close: () => agent.destroy() };
}

const ADAPTER = fileURLToPath(new URL("../../server/dist/mcp.js", import.meta.url));

/** Abre un proceso MCP stdio para una identidad, igual que un cliente real. @param {string} base @param {string} token @param {string} name */
export async function mcpSession(base, token, name) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: `scale-${name}`, version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [ADAPTER], stderr: "ignore",
    env: { PATH: process.env.PATH ?? "", COORDINATION_API_URL: base, AGENT_TOKEN: token },
  }));
  return {
    /** @param {string} tool @param {unknown} args @returns {Promise<Response>} */
    async call(tool, args) {
      const started = performance.now();
      try {
        const result = /** @type {any} */ (await client.callTool({ name: tool, arguments: /** @type {any} */ (args) }));
        const text = result.content?.[0]?.text ?? "";
        const ms = performance.now() - started;
        if (result.isError) {
          // El adaptador sólo expone "Coordinación HTTP <status>"; el cuerpo no cruza la frontera MCP.
          const status = Number(/HTTP (\d+)/.exec(text)?.[1] ?? 0);
          return { status, text, body: { error: "mcp" }, ms, ...(!status && { error: text }) };
        }
        // `text` es lo que vería el modelo: es lo que se escanea en busca de fugas.
        return { status: 200, text, body: result.structuredContent ?? JSON.parse(text), ms };
      } catch (error) {
        return { status: 0, text: "", body: undefined, ms: performance.now() - started, error: String(error) };
      }
    },
    close: () => client.close(),
  };
}
