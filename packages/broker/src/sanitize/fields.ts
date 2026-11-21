import { ToolResultSchemas, type ToolName } from "@team-31/protocol";

/**
 * How each result field is canonicalized and whether leak-guard inspects it as free text.
 * Every field of every `ToolResultSchemas[tool]` must have a spec (enforced by a test), so a new
 * protocol field cannot silently skip canonicalization.
 */
export type FieldSpec =
  | { kind: "line"; maxLength: number }
  | { kind: "text"; maxLength: number }
  | { kind: "boolean" }
  | { kind: "slots" }
  | { kind: "date" }
  | { kind: "datetime" };

export type FieldSpecs = Record<ToolName, Record<string, FieldSpec>>;

export const FIELD_SPECS: FieldSpecs = {
  vault_access: { accepted: { kind: "boolean" } },
  interest_check: {
    matches: { kind: "boolean" },
  },
  connect: {
    accepted: { kind: "boolean" },
  },
  profile: {
    displayName: { kind: "line", maxLength: 80 },
    headline: { kind: "line", maxLength: 160 },
  },
  availability: {
    available: { kind: "boolean" },
    freeSlots: { kind: "slots" },
  },
  question: {
    answer: { kind: "text", maxLength: 1000 },
  },
};

export function isFreeText(spec: FieldSpec | undefined): boolean {
  return spec?.kind === "line" || spec?.kind === "text";
}

/** True when the tool schema accepts the field being absent. */
export function isOptionalField(tool: ToolName, field: string): boolean {
  const shape = ToolResultSchemas[tool].shape as Record<string, { safeParse(v: unknown): { success: boolean } }>;
  return shape[field]?.safeParse(undefined).success ?? false;
}
