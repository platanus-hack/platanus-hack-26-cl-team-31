// The runtime fixes the source and the interest before starting this stdio tool.
import { readFile, writeFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const [source, interest, receipt] = process.argv.slice(2);
const compareInterest = new Intl.Collator("es", { sensitivity: "base" });
const server = new McpServer({ name: "owner", version: "1" });
server.registerTool("check_interest", {
  description: "Consulta el interés de esta solicitud en la fuente privada del contacto. Devuelve matches o null si falta la fuente.",
  inputSchema: {},
}, async () => {
  let result = null;
  try {
    const entries = JSON.parse(await readFile(source, "utf8"));
    if (!Array.isArray(entries) || !entries.every(item => typeof item === "string")) {
      throw new Error("La fuente debe ser un arreglo JSON de intereses.");
    }
    result = { matches: entries.some(item => compareInterest.compare(item.trim(), interest.trim()) === 0) };
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("No se pudo leer la fuente de intereses del contacto.");
  }
  const text = JSON.stringify(result);
  await writeFile(receipt, text, { mode: 0o600 });
  return { content: [{ type: "text", text }] };
});
await server.connect(new StdioServerTransport());
