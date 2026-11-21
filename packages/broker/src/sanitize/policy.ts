import { filterResult } from "../policy/index.js";
import { addDropped, addFlags, asRecord, type SyncStage } from "./types.js";

/** Delegates to the shared policy filter; never reimplements field whitelisting. */
export const policy: SyncStage = (state, ctx) => {
  asRecord(state.value, "policy");
  const filtered = filterResult(ctx.tool, state.value, ctx.allowedFields);
  return addFlags(
    addDropped({ ...state, value: filtered.result }, filtered.dropped),
    filtered.dropped.map((field) => ({ stage: "policy" as const, code: "policy_field_dropped" as const, field })),
  );
};
