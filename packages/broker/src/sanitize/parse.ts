import { ToolName, ToolResultSchemas, fieldsOf } from "@team-31/protocol";
import {
  addDropped,
  addFlags,
  invalid,
  limitsOf,
  type Limits,
  type SanitizeFlag,
  type SyncStage,
} from "./types.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function snapshotArray(value: unknown[], field: string, limits: Limits): unknown[] {
  if (value.length > limits.maxRawArrayLength) {
    throw invalid(`La respuesta excede el máximo de ${limits.maxRawArrayLength} elementos en ${field}.`);
  }
  const out: unknown[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const desc = Object.getOwnPropertyDescriptor(value, i);
    if (!desc || !("value" in desc)) throw invalid(`La respuesta no cumple el formato: revisa ${field}.${i}.`);
    out.push(desc.value);
  }
  return out;
}

function checkScalar(value: unknown, field: string, limits: Limits): unknown {
  if (typeof value === "string" && value.length > limits.maxRawStringLength) {
    throw invalid(`La respuesta excede el largo máximo en ${field}.`);
  }
  return value;
}

/**
 * Reads the raw reply exactly once into a fresh plain object: rejects non-plain objects, accessors
 * (getters could change between reads), prototype-pollution keys and oversized payloads.
 */
function snapshot(raw: unknown, known: ReadonlySet<string>, limits: Limits) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("La respuesta debe ser un objeto.");
  }
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) throw invalid("La respuesta debe ser un objeto simple.");

  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Object.keys(descriptors);
  if (keys.length > limits.maxKeys) throw invalid(`La respuesta excede el máximo de ${limits.maxKeys} campos.`);

  const value: Record<string, unknown> = {};
  const unknown: string[] = [];
  const hidden: string[] = [];
  for (const key of keys) {
    if (key.length > limits.maxKeyLength) throw invalid("La respuesta contiene un nombre de campo demasiado largo.");
    if (FORBIDDEN_KEYS.has(key)) throw invalid(`La respuesta contiene un campo prohibido: ${key}.`);
    const desc = descriptors[key]!;
    if (!("value" in desc)) throw invalid(`La respuesta contiene un campo calculado: ${key}.`);
    if (!known.has(key)) {
      unknown.push(key);
      continue;
    }
    if (!desc.enumerable) {
      hidden.push(key);
      continue;
    }
    const field = desc.value;
    value[key] = Array.isArray(field)
      ? snapshotArray(field, key, limits).map((item, i) => checkScalar(item, `${key}.${i}`, limits))
      : checkScalar(field, key, limits);
  }
  return { value, unknown, hidden };
}

/** Strict parse against `ToolResultSchemas[tool]`; unknown keys are dropped (or rejected). */
export const parse: SyncStage = (state, ctx) => {
  const tool = ToolName.safeParse(ctx.tool);
  if (!tool.success) throw invalid("Herramienta desconocida.");

  const limits = limitsOf(ctx);
  const known = new Set(fieldsOf(tool.data));
  const { value, unknown, hidden } = snapshot(state.value, known, limits);

  if (ctx.unknownKeys === "reject" && unknown.length > 0) {
    throw invalid(`La respuesta contiene campos no permitidos para ${tool.data}: ${unknown.join(", ")}.`);
  }

  const parsed = ToolResultSchemas[tool.data].safeParse(value);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "resultado";
    throw invalid(`La respuesta no cumple el formato de ${tool.data}: revisa ${field}.`);
  }

  const flags: SanitizeFlag[] = [
    ...unknown.map((field): SanitizeFlag => ({ stage: "parse", code: "unknown_field_dropped", field })),
    ...hidden.map((field): SanitizeFlag => ({ stage: "parse", code: "non_enumerable_field_dropped", field })),
  ];
  return addFlags(addDropped({ ...state, value: parsed.data }, [...unknown, ...hidden]), flags);
};
