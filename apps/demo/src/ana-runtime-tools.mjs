import { appendFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Address, ToolArgs } from "@team-31/protocol";
import { z } from "zod";
import { createContactQueries, demoTelemetry } from "./contact-broker.mjs";

const [directoryJson, receipt, fixtureId] = process.argv.slice(2);
const demo = createContactQueries(JSON.parse(directoryJson), { fixtureId });
const server = new McpServer({ name: "ana", version: "1" });
async function observed(value) {
  const text = JSON.stringify(value);
  await appendFile(receipt, text + "\n", { mode: 0o600 });
  return { content: [{ type: "text", text }] };
}
server.registerTool("list_contacts", {
  description: "Lista los nombres y direcciones de la agenda de Ana.",
  inputSchema: {},
}, () => observed({ contacts: demo.listContacts() }));
server.registerTool("ask_contact", {
  description: "Consulta a un contacto de la agenda. Usa interest para comprobar un interés concreto o text para preguntas abiertas.",
  inputSchema: { contact: Address, query: z.union([ToolArgs.interest_check, ToolArgs.question]) },
}, async ({ contact, query }) => {
  const tool = "interest" in query ? "interest_check" : "question";
  return observed(await demo.ask(contact, tool, query));
});
server.registerTool("await_contact", {
  description: "Espera la respuesta del contacto para esta solicitud de Ana.",
  inputSchema: { requestId: z.string().uuid() },
}, async ({ requestId }) => observed(await demo.result(requestId)));
const transport = new StdioServerTransport();
await server.connect(transport);
process.stdin.once("end", () => { void demoTelemetry.shutdown(); });
