import { z } from "zod";
import { Address } from "./address.js";

export const CircleName = z.string().trim().min(1).max(60);

// Members who joined give each other the base policy. `joined: false` is a pending invitation.
export const Circle = z.object({
  id: z.string(),
  name: CircleName,
  owner: Address,
  members: z.array(z.object({ address: Address, joined: z.boolean() })),
});
export type Circle = z.infer<typeof Circle>;
