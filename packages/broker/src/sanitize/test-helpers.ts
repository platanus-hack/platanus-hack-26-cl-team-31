import type { ToolName } from "@team-31/protocol";
import type { SanitizeContext, SanitizeState } from "./types.js";

export const allFields: Record<ToolName, string[]> = {
  profile: ["displayName", "headline"],
  availability: ["available", "freeSlots"],
  question: ["answer"],
  interest_check: ["matches"],
  connect: ["accepted"],
  vault_access: ["accepted"],
  category_access: ["accepted"],
};

export function ctxFor(tool: ToolName, overrides: Partial<SanitizeContext> = {}): SanitizeContext {
  return { tool, allowedFields: allFields[tool], ...overrides };
}

export function stateOf(value: unknown): SanitizeState {
  return { value, dropped: [], flags: [] };
}
