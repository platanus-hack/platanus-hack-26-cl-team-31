#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { coordinationServer } from "./coordination.js";

async function main() {
  const { COORDINATION_API_URL: url, AGENT_TOKEN: token } = process.env;
  const devAuth = process.env.MCP_DEV_AUTH === "1";
  if (devAuth && process.env.NODE_ENV === "production") {
    console.error("[nexo-mcp] MCP_DEV_AUTH no se puede activar en producción.");
    process.exitCode = 1;
    return;
  }

  if (token) {
    if (!url) {
      console.error("[team-31-mcp] AGENT_TOKEN requiere COORDINATION_API_URL.");
      process.exitCode = 1;
      return;
    }
    await coordinationServer(url, token).connect(new StdioServerTransport());
    console.error("[team-31-mcp] Coordinación lista en stdio.");
    return;
  }

  const { startNexo } = await import("./nexo.js");
  await startNexo(process.argv.includes("--stdio"), devAuth);
}

main().catch((error: unknown) => {
  // Startup errors from configuration contain only the name of the variable.
  const message = error instanceof Error && (
    error.message.startsWith("Revisa el valor de ") ||
    error.message.startsWith("MCP_") ||
    error.message.startsWith("El modo stdio requiere ")
  ) ? error.message : "Revisa la configuración y la disponibilidad del puerto.";
  console.error(`[nexo-mcp] Error de arranque. ${message}`);
  process.exitCode = 1;
});
