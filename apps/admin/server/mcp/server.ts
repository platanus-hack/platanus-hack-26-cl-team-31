import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { AdminTokenScope } from "../../shared/contract.js"
import { AdminQueryError } from "../../shared/queries.js"
import { z } from "zod"
import type { AdminMcpDeps, TokenPrincipal } from "./index.js"
import { instructions } from "./instructions.js"
import { SCHEMA_URI, loadAdminSchema } from "./schema.js"
import { adminTools, type AdminTool } from "./tools.js"

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

function failure(error: unknown): CallToolResult {
  if (error instanceof AdminQueryError) {
    if (error.code === "not_found") return toolError(error.message)
    if (error.code === "timeout") return toolError("La consulta superó el límite de 3 s. Acota los filtros o la ventana.")
    return toolError(`Entrada inválida: ${error.message}`)
  }
  if (error instanceof z.ZodError) return toolError(`Entrada inválida: ${z.prettifyError(error)}`)
  // TODO(admin): telemetry.error("mcp admin tool", error) y devolver su errorId (ADM-01).
  return toolError("No se pudo completar la consulta por un error interno.")
}

async function callTool(principal: TokenPrincipal, deps: AdminMcpDeps, spec: AdminTool, args: unknown): Promise<CallToolResult> {
  try {
    await deps.audit({ actor: principal, action: `mcp:${spec.name}`, target: spec.target?.(args as never) ?? null })
  } catch {
    // Fallar cerrado: sin auditoría no se entrega ningún dato.
    // TODO(admin): telemetry.error("mcp admin audit", error) (ADM-01).
    return toolError("No se pudo registrar la auditoría; la consulta no se ejecutó.")
  }

  const required = spec.scope ?? "admin:read"
  if (!hasScope(principal, required)) {
    return toolError(`El token no tiene el scope ${required}. Pide a un operador un token con ese permiso en el panel (Tokens MCP).`)
  }

  try {
    const outcome = await spec.run(args as never)
    if ("notFound" in outcome) return toolError(outcome.notFound)
    // Parsear con el esquema del contrato descarta cualquier campo que no esté declarado.
    const data = spec.output.parse(outcome.data) as Record<string, unknown>
    return {
      content: [
        { type: "text", text: outcome.text },
        { type: "text", text: JSON.stringify(data) },
      ],
      structuredContent: data,
    }
  } catch (error) {
    return failure(error)
  }
}

export function createAdminMcpServer(principal: TokenPrincipal, deps: AdminMcpDeps): McpServer {
  const server = new McpServer({ name: "nexo-admin", version: ADMIN_MCP_VERSION }, { instructions })

  for (const spec of adminTools(deps.queries)) {
    server.registerTool(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: spec.input, outputSchema: spec.output, annotations },
      (args: unknown) => callTool(principal, deps, spec, args),
    )
  }

  server.registerResource(
    "schema",
    SCHEMA_URI,
    {
      title: "Esquema de datos del admin",
      description: "Vistas ops.v_* con sus columnas y el catálogo de eventos de telemetría.",
      mimeType: "application/json",
    },
    async (uri) => {
      await deps.audit({ actor: principal, action: "mcp:resource", target: SCHEMA_URI })
      if (!hasScope(principal, "admin:read")) throw new McpError(ErrorCode.InvalidRequest, "El token no tiene el scope admin:read.")
      const schema = await loadAdminSchema(deps.queries)
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(schema) }] }
    },
  )

  return server
}
