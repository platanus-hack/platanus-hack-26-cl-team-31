import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { Telemetry } from "@team-31/telemetry"
import type { AdminTokenScope } from "../../shared/contract.js"
import { AdminQueryError } from "../../shared/queries.js"
import { z } from "zod"
import { instructions } from "./instructions.js"
import { SCHEMA_URI, loadAdminSchema } from "./schema.js"
import { registerAdminTools, type AdminTool } from "./tools.js"
import type { AdminMcpDeps, TokenPrincipal } from "./types.js"

export const ADMIN_MCP_VERSION = "0.1.0"

const annotations = { readOnlyHint: true, openWorldHint: false } as const

function toolError(message: string): CallToolResult {
  // Sin structuredContent: los clientes lo validarían contra el outputSchema de la tool.
  return { isError: true, content: [{ type: "text", text: message }] }
}

export function hasScope(principal: TokenPrincipal, scope: AdminTokenScope): boolean {
  // admin:sql incluye la lectura: con SQL se puede leer todo lo que exponen las demás tools.
  if (scope === "admin:read") return principal.scopes.includes("admin:read") || principal.scopes.includes("admin:sql")
  return principal.scopes.includes(scope)
}

function failure(error: unknown, errorId: string): CallToolResult {
  if (error instanceof AdminQueryError) {
    if (error.code === "not_found") return toolError(error.message)
    if (error.code === "timeout") return toolError("La consulta superó el límite de 3 s. Acota los filtros o la ventana.")
    return toolError(`Entrada inválida: ${error.message}`)
  }
  if (error instanceof z.ZodError) return toolError(`Entrada inválida: ${z.prettifyError(error)}`)
  return toolError(`No se pudo completar la consulta por un error interno. Referencia: ${errorId}.`)
}

async function callTool<I extends z.ZodObject, O extends z.ZodObject>(
  principal: TokenPrincipal, deps: AdminMcpDeps, spec: AdminTool<I, O>, args: z.output<I>, telemetry: Telemetry,
): Promise<CallToolResult> {
  try {
    await deps.audit({ actor: principal, action: `mcp:${spec.name}`, target: spec.target?.(args) ?? null })
  } catch (error) {
    // Fallar cerrado: sin auditoría no se entrega ningún dato.
    const errorId = telemetry.error("admin.mcp.audit", error)
    return toolError(`No se pudo registrar la auditoría. Referencia: ${errorId}.`)
  }

  const required = spec.scope ?? "admin:read"
  if (!hasScope(principal, required)) {
    telemetry.emit("mcp.tool.call", { attrs: { tool: spec.name, outcome: "denied" } })
    return toolError(`El token no tiene el scope ${required}. Pide a un operador un token con ese permiso en el panel (Tokens MCP).`)
  }

  try {
    const outcome = await spec.run(args)
    if ("notFound" in outcome) return toolError(outcome.notFound)
    // Parsear con el esquema del contrato descarta cualquier campo que no esté declarado.
    const parsed = spec.output.safeParse(outcome.data)
    if (!parsed.success) {
      const errorId = telemetry.error("admin.mcp.output", parsed.error)
      return toolError(`La consulta devolvió una respuesta inválida. Referencia: ${errorId}.`)
    }
    const data = parsed.data
    telemetry.emit("mcp.tool.call", { attrs: { tool: spec.name, outcome: "ok" } })
    return {
      content: [
        { type: "text", text: outcome.text },
        { type: "text", text: JSON.stringify(data) },
      ],
      structuredContent: data,
    }
  } catch (error) {
    return failure(error, telemetry.error("admin.mcp.tool", error))
  }
}

export function createAdminMcpServer(principal: TokenPrincipal, deps: AdminMcpDeps, telemetry: Telemetry): McpServer {
  const server = new McpServer({ name: "nexo-admin", version: ADMIN_MCP_VERSION }, { instructions })

  registerAdminTools(deps.queries, <I extends z.ZodObject, O extends z.ZodObject>(spec: AdminTool<I, O>) => {
    const handle = (args: z.output<I>) => callTool(principal, deps, spec, args, telemetry)
    server.registerTool<O, I>(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: spec.input, outputSchema: spec.output, annotations },
      // El SDK ya valida contra I antes de llamar al callback.
      handle as ToolCallback<I>,
    )
  })

  server.registerResource(
    "schema",
    SCHEMA_URI,
    {
      title: "Esquema de datos del admin",
      description: "Vistas ops.v_* con sus columnas y el catálogo de eventos de telemetría.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        await deps.audit({ actor: principal, action: "mcp:resource", target: SCHEMA_URI })
      } catch (error) {
        const errorId = telemetry.error("admin.mcp.audit", error)
        throw new McpError(ErrorCode.InternalError, "No se pudo registrar la auditoría.", { errorId })
      }
      if (!hasScope(principal, "admin:read")) throw new McpError(ErrorCode.InvalidRequest, "El token no tiene el scope admin:read.")
      const schema = await loadAdminSchema(deps.queries, telemetry)
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(schema) }] }
    },
  )

  return server
}
