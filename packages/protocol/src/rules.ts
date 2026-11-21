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

export const connectionCircle = "Amigos";

export const connectionGrants: SharingRules["grants"][string] = [
  { tool: "availability", fields: ["available", "freeSlots"], guidance: "", never: false },
  { tool: "interest_check", fields: ["matches"], guidance: "", never: false },
];

export function addConnection(rules: SharingRules, address: Address): SharingRules {
  const members = (Object.hasOwn(rules.circles, connectionCircle) && rules.circles[connectionCircle]) || [];
  const grants = Object.hasOwn(rules.grants, connectionCircle) ? rules.grants[connectionCircle] : undefined;
  return {
    ...rules,
    circles: { ...rules.circles, [connectionCircle]: members.includes(address) ? members : [...members, address] },
    grants: { ...rules.grants, [connectionCircle]: grants ?? connectionGrants.map((grant) => ({ ...grant, fields: [...grant.fields] })) },
  };
}

export function removeConnection(rules: SharingRules, address: Address): SharingRules {
  const members = (Object.hasOwn(rules.circles, connectionCircle) && rules.circles[connectionCircle]) || [];
  return { ...rules, circles: { ...rules.circles, [connectionCircle]: members.filter((member) => member !== address) } };
}
