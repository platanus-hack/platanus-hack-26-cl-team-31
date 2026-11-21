import { z } from "zod";
import { Address } from "./address.js";
import { fieldsOf, ToolName } from "./tools.js";

// Connection invitations have their own consent flow.
export const GrantTool = ToolName.exclude(["profile", "connect"]);
export type GrantTool = z.infer<typeof GrantTool>;

export const GrantInput = z.object({
  grantee: Address,
  tool: GrantTool,
  fields: z.array(z.string()).min(1),
}).refine(
  ({ tool, fields }) => fields.every((field) => fieldsOf(tool).includes(field)),
  { error: "Los campos no corresponden a la herramienta.", path: ["fields"] },
);
export type GrantInput = z.infer<typeof GrantInput>;

// The owner who lists it is the grantor: they let `grantee` use `tool` and receive `fields`.
export const Grant = z.object({
  id: z.string(),
  grantee: Address,
  tool: GrantTool,
  fields: z.array(z.string()),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Grant = z.infer<typeof Grant>;
