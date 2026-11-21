import { ToolResultSchemas, type ToolName, type ToolResult } from "@team-31/protocol";
import { BrokerError } from "./errors.js";

export type FilteredResult = {
  result: ToolResult;
  delivered: string[];
  dropped: string[];
};

function parseResult(tool: ToolName, result: unknown): ToolResult {
  const parsed = ToolResultSchemas[tool].safeParse(result);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "resultado";
    throw new BrokerError("invalid_input", `La respuesta no cumple el formato de ${tool}: revisa ${field}.`);
  }

  return parsed.data;
}

export function filterResult(
  tool: ToolName,
  result: unknown,
  allowedFields: readonly string[],
): FilteredResult {
  const parsed = parseResult(tool, result);
  const allowed = Object.entries(parsed).filter(([field]) => allowedFields.includes(field));
  const filtered = parseResult(tool, Object.fromEntries(allowed));
  const delivered = Object.keys(filtered);

  return {
    result: filtered,
    delivered,
    dropped: Object.keys(result as object).filter((field) => !delivered.includes(field)),
  };
}
