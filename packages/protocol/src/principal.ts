import { z } from "zod";

export const Scope = z.enum(["sideband:ask", "sideband:inbox", "sideband:reply", "sideband:status", "sideband:accept", "sideband:vault"]);
export type Scope = z.infer<typeof Scope>;

export const WAKE_SUBSCRIPTION_SCOPE = "sideband:inbox" satisfies Scope;

export const agentScopes = {
  tags: "sideband:vault",
  changeTag: "sideband:vault",
  inviteToCircle: "sideband:vault",
  vaultCatalog: "sideband:vault",
  vaultMembers: "sideband:vault",
  changeVault: "sideband:vault",
  uploadVaultDocument: "sideband:vault",
  searchPublicProfiles: "sideband:ask",
  queryVault: "sideband:ask",
  downloadVaultDocument: "sideband:ask",
  networkUsers: "sideband:ask",
  capabilities: "sideband:ask",
  ask: "sideband:ask",
  contacts: "sideband:ask",
  inbox: "sideband:inbox",
  reply: "sideband:reply",
  "reply.connect": "sideband:accept",
  status: "sideband:status",
  activity: "sideband:status",
  pending: "sideband:status",
  connectWake: WAKE_SUBSCRIPTION_SCOPE,
  disconnectWake: WAKE_SUBSCRIPTION_SCOPE,
} as const satisfies Record<string, Scope>;

export const Principal = z.object({
  userId: z.string(),
  agentId: z.string(),
  scopes: z.array(Scope),
});
export type Principal = z.infer<typeof Principal>;

export const Owner = z.object({ userId: z.string() });
export type Owner = z.infer<typeof Owner>;
