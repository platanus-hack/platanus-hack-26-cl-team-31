import { z } from "zod";

export const Scope = z.enum(["nexo:ask", "nexo:inbox", "nexo:reply", "nexo:status"]);
export type Scope = z.infer<typeof Scope>;

export const WAKE_SUBSCRIPTION_SCOPE = "nexo:inbox" satisfies Scope;

export const Principal = z.object({
  userId: z.string(),
  agentId: z.string(),
  scopes: z.array(Scope),
});
export type Principal = z.infer<typeof Principal>;

export const Owner = z.object({ userId: z.string() });
export type Owner = z.infer<typeof Owner>;
