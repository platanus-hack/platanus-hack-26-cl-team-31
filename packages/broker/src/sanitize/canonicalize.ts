import { ToolResultSchemas } from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import { FIELD_SPECS, isOptionalField, type FieldSpec, type FieldSpecs } from "./fields.js";
import { canonicalDate, canonicalDateTime, canonicalLine, canonicalText, normalizeSlots } from "./text.js";
import { addFlags, asRecord, invalid, type SanitizeFlag, type SyncStage } from "./types.js";

type FieldOutcome = { value: unknown; flags: SanitizeFlag[] };

function flag(code: SanitizeFlag["code"], field: string): SanitizeFlag {
  return { stage: "canonicalize", code, field };
}

function canonicalField(field: string, value: unknown, spec: FieldSpec): FieldOutcome {
  switch (spec.kind) {
    case "boolean":
      return { value, flags: [] };
    case "line":
    case "text": {
      if (typeof value !== "string") throw invalid(`La respuesta no cumple el formato: revisa ${field}.`);
      const out = spec.kind === "line" ? canonicalLine(value, spec.maxLength) : canonicalText(value, spec.maxLength);
      const flags: SanitizeFlag[] = [];
      if (out.removedInvisible) flags.push(flag("invisible_chars_removed", field));
      if (out.truncated) flags.push(flag("truncated", field));
      if (out.changed && flags.length === 0) flags.push(flag("text_normalized", field));
      return { value: out.text, flags };
    }
    case "slots": {
      if (!Array.isArray(value)) throw invalid(`La respuesta no cumple el formato: revisa ${field}.`);
      const out = normalizeSlots(value as string[]);
      const flags: SanitizeFlag[] = [];
      if (out.invalid > 0) flags.push(flag("slot_invalid_dropped", field));
      if (out.changed) flags.push(flag("slots_normalized", field));
      return { value: out.slots, flags };
    }
    case "date":
    case "datetime": {
      const out = typeof value === "string"
        ? spec.kind === "date" ? canonicalDate(value) : canonicalDateTime(value)
        : undefined;
      if (out === undefined) throw invalid(`La respuesta no cumple el formato: revisa ${field}.`);
      return { value: out, flags: out === value ? [] : [flag("text_normalized", field)] };
    }
  }
}

/** Builds a canonicalize stage for a given spec table (the default uses `FIELD_SPECS`). */
export function createCanonicalize(specs: FieldSpecs = FIELD_SPECS): SyncStage {
  return (state, ctx) => {
    const input = asRecord(state.value, "canonicalize");
    const toolSpecs = specs[ctx.tool];
    const schema = ToolResultSchemas[ctx.tool];
    const out: Record<string, unknown> = {};
    const flags: SanitizeFlag[] = [];

    for (const [field, value] of Object.entries(input)) {
      const spec = toolSpecs[field];
      // Fail closed: a field without a spec means FIELD_SPECS is out of date with the protocol.
      if (!spec) throw new BrokerError("internal", `Falta la regla de normalización para ${ctx.tool}.${field}.`);
      if (value === undefined) continue;

      const result = canonicalField(field, value, spec);
      flags.push(...result.flags);
      if (result.value === "" && isOptionalField(ctx.tool, field)) {
        flags.push(flag("empty_optional_removed", field));
        continue;
      }
      out[field] = result.value;
    }

    if (ctx.tool === "availability" && out.available === false && Array.isArray(out.freeSlots) && out.freeSlots.length > 0) {
      flags.push(flag("availability_inconsistent", "freeSlots"));
    }

    const parsed = schema.safeParse(out);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path.join(".") || "resultado";
      throw invalid(`La respuesta queda vacía o inválida tras normalizarla: revisa ${field}.`);
    }
    return addFlags({ ...state, value: parsed.data }, flags);
  };
}

export const canonicalize: SyncStage = createCanonicalize();
