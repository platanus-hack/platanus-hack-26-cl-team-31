import { z } from "zod";
import { Address } from "./address.js";
import { ToolName, ToolResultSchemas } from "./tools.js";

const personGrant = z.object({
  tool: ToolName,
  fields: z.array(z.string()),
  guidance: z.string().default(""),
});

const circleGrant = personGrant.extend({ never: z.boolean().default(false) });

export const SharingRules = z.object({
  publicProfile: ToolResultSchemas.profile.optional(),
  circles: z.record(z.string(), z.array(Address)),
  grants: z.record(z.string(), z.array(circleGrant)),
  people: z.record(Address, z.array(personGrant)).default({}),
  blocked: z.array(Address).default([]),
  defaultForUnknown: z.enum(["ask_owner", "deny"]).default("ask_owner"),
});
export type SharingRules = z.infer<typeof SharingRules>;
