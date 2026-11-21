import { writeFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { startDemoBroker } from "../../../packages/broker/scripts/demo-broker.mjs";

const demo = await startDemoBroker(process.argv[2]);
const server = new McpServer({ name: "ana", version: "1" });
const result = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
server.registerTool("ask_bob", {
  description: "Pregunta si a Bob le interesa un tema. Devuelve el ID de la solicitud de Ana.",
  inputSchema: { interest: z.string().trim().min(1).max(128) },
}, async ({ interest }) => result(await demo.ask(interest)));
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
