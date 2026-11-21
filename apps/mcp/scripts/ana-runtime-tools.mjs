import { writeFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { startDemoBroker } from "../../../packages/broker/scripts/demo-broker.mjs";

const demo = await startDemoBroker(process.argv[2]);
const server = new McpServer({ name: "ana", version: "1" });
const result = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
async function ask(tool, args) {
  const view = await demo.ask(tool, args);
  if (view.final) await writeFile(process.argv[3], JSON.stringify(view), { mode: 0o600 });
  return result(view);
}
server.registerTool("ask_bob", {
  description: "Pregunta si a Bob le interesa un tema. Devuelve el ID de la solicitud de Ana.",
  inputSchema: { interest: z.string().trim().min(1).max(128) },
}, ({ interest }) => ask("interest_check", { interest }));
server.registerTool("ask_bob_question", {
  description: "Envía una pregunta abierta a Bob. El broker decide si Ana tiene permiso.",
  inputSchema: { text: z.string().min(1).max(1000) },
}, ({ text }) => ask("question", { text }));
server.registerTool("await_bob", {
  description: "Espera la respuesta validada por el broker a la solicitud de Ana.",
  inputSchema: { requestId: z.string().uuid() },
}, async ({ requestId }) => {
  const view = await demo.result(requestId);
  await writeFile(process.argv[3], JSON.stringify(view), { mode: 0o600 });
  return result(view);
});
const transport = new StdioServerTransport();
await server.connect(transport);
process.stdin.once("end", () => demo.close());
