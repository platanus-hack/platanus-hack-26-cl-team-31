// Reglas de AdminQueries.sql(): un solo SELECT/WITH sobre ops.v_* (docs/admin.md, ADM-02).
// Es una defensa en profundidad: lo que realmente impide escribir o leer tablas privadas es la
// transacción READ ONLY, el rol sideband_admin_ro y el protocolo extendido (una sola sentencia).
import { AdminQueryError } from "../../shared/queries.js"

export const SQL_MAX_ROWS = 200

// Funciones que cambian la configuración de la sesión (por ejemplo `role`, que volvería al usuario
// de la conexión) o que ejecutan SQL dinámico.
const FORBIDDEN = [
  /\bset_config\b/,
  /\b(query|cursor|table|schema|database)_to_xml(schema|_and_xmlschema)?\b/,
  /\bdblink\w*\b/,
  /\blo_(import|export|get|put|from_bytea|open)\b/,
  /\bpg_read_(binary_)?file\b/,
  /\bpg_ls_\w+\b/,
]

type Scan = { code: string; statements: number }

// Recorre el texto separando código de literales, identificadores entre comillas y comentarios.
// Devuelve el código sin literales ni comentarios (identificadores sin comillas) y cuántas
// sentencias no vacías contiene.
function scan(input: string): Scan {
  let code = ""
  let statements = 0
  let current = ""
  let index = 0
  const flush = () => {
    if (current.trim()) statements++
    current = ""
  }
  while (index < input.length) {
    const char = input[index]!
    const rest = input.slice(index)
    if (rest.startsWith("--")) {
      const end = input.indexOf("\n", index)
      index = end === -1 ? input.length : end + 1
      code += " "
      continue
    }
    if (rest.startsWith("/*")) {
      let depth = 0
      let cursor = index
      do {
        if (input.startsWith("/*", cursor)) {
          depth++
          cursor += 2
        } else if (input.startsWith("*/", cursor)) {
          depth--
          cursor += 2
        } else if (cursor >= input.length) {
          throw new AdminQueryError("invalid_input", "Comentario sin cerrar.")
        } else {
          cursor++
        }
      } while (depth > 0)
      index = cursor
      code += " "
      continue
    }
    if (char === "'") {
      // E'...' acepta escapes con barra invertida.
      const escapes = /(^|[^A-Za-z0-9_$])[eE]$/.test(
        input.slice(Math.max(0, index - 2), index)
      )
      let cursor = index + 1
      for (;;) {
        if (cursor >= input.length)
          throw new AdminQueryError("invalid_input", "Literal sin cerrar.")
        if (escapes && input[cursor] === "\\") cursor += 2
        else if (input[cursor] === "'" && input[cursor + 1] === "'") cursor += 2
        else if (input[cursor] === "'") break
        else cursor++
      }
      index = cursor + 1
      code += " '' "
      current += "x"
      continue
    }
    if (char === '"') {
      const end = input.indexOf('"', index + 1)
      if (end === -1)
        throw new AdminQueryError("invalid_input", "Identificador sin cerrar.")
      const identifier = input.slice(index + 1, end)
      index = end + 1
      code += identifier
      current += identifier
      continue
    }
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)
    if (dollar && !/[A-Za-z0-9_]/.test(input[index - 1] ?? "")) {
      const tag = dollar[0]
      const end = input.indexOf(tag, index + tag.length)
      if (end === -1)
        throw new AdminQueryError("invalid_input", "Literal sin cerrar.")
      index = end + tag.length
      code += " '' "
      current += "x"
      continue
    }
    if (char === ";") {
      flush()
      code += " ; "
      index++
      continue
    }
    code += char
    current += char
    index++
  }
  flush()
  return { code, statements }
}

// Devuelve la consulta lista para envolver (sin `;` final) o lanza invalid_input.
export function checkReadOnlySql(sql: string): string {
  const { code, statements } = scan(sql)
  if (statements !== 1) {
    throw new AdminQueryError(
      "invalid_input",
      "Se acepta exactamente una sentencia."
    )
  }
  const normalized = code.replace(/\s+/g, " ").trim().toLowerCase()
  // La única sentencia puede terminar en `;`. Cualquier otro `;` ya quedó contado arriba.
  if (
    !/^(select|with)\b/.test(normalized) &&
    !/^\(+\s*(select|with)\b/.test(normalized)
  ) {
    throw new AdminQueryError(
      "invalid_input",
      "Solo se aceptan consultas SELECT o WITH."
    )
  }
  if (normalized.includes("v_request_payloads")) {
    throw new AdminQueryError(
      "invalid_input",
      "ops.v_request_payloads no está disponible por SQL."
    )
  }
  if (FORBIDDEN.some((pattern) => pattern.test(normalized))) {
    throw new AdminQueryError(
      "invalid_input",
      "La consulta usa una función no permitida."
    )
  }
  return sql.trim().replace(/;\s*$/, "")
}

// LIMIT envolviendo la consulta: el cliente nunca recibe más de SQL_MAX_ROWS filas.
// Los saltos de línea evitan que un comentario `--` final se coma el cierre.
export function wrapWithLimit(sql: string): string {
  return `SELECT * FROM (\n${sql}\n) AS admin_sql LIMIT ${SQL_MAX_ROWS + 1}`
}
