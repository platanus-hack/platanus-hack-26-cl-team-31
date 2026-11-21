import { z } from "zod";
import { Address } from "./address.js";
import { Category } from "./categories.js";

export const GrantInput = z.object({ grantee: Address, category: Category });
export type GrantInput = z.infer<typeof GrantInput>;

// The owner who lists it is the grantor: they let `grantee` ask about `category`.
export const Grant = z.object({
  id: z.string(),
  grantee: Address,
  category: Category,
  createdAt: z.iso.datetime({ offset: true }),
});
export type Grant = z.infer<typeof Grant>;
