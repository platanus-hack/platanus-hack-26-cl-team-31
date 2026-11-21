import { z } from "zod";
import { Address } from "./address.js";
import { ContactTag } from "./sharing.js";

const name = z.string().trim().min(1).max(80);
const categoryId = z.uuid();
const value = z.union([z.string().trim().min(1).max(2000), z.number(), z.boolean()]);
export const VaultEntry = z.object({ label: name, value });
export const VaultCategory = z.object({ id: categoryId, name });
export const VaultCatalog = z.object({ categories: z.array(VaultCategory) });
export type VaultCatalog = z.infer<typeof VaultCatalog>;
export const OwnerVault = z.object({ categories: z.array(VaultCategory.extend({
  groups: z.array(ContactTag), entries: z.array(VaultEntry),
})) });
export type OwnerVault = z.infer<typeof OwnerVault>;
export const VaultQuery = z.strictObject({ to: Address, categoryId: categoryId.optional() });
export type VaultQuery = z.infer<typeof VaultQuery>;
// Listing never returns contents. A missing or inaccessible category gives the same empty catalog.
export const VaultResult = z.object({ categories: z.array(VaultCategory.extend({ entries: z.array(VaultEntry).optional() })) });
export type VaultResult = z.infer<typeof VaultResult>;
export const VaultChange = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), name }),
  z.strictObject({ action: z.literal("rename"), categoryId, name }),
  z.strictObject({ action: z.literal("delete"), categoryId }),
  z.strictObject({ action: z.literal("put_entry"), categoryId, ...VaultEntry.shape }),
  z.strictObject({ action: z.literal("delete_entry"), categoryId, label: name }),
  z.strictObject({ action: z.literal("set_group"), categoryId, group: ContactTag, allowed: z.boolean() }),
]);
export type VaultChange = z.infer<typeof VaultChange>;
export const VaultReceipt = z.object({ categoryId });
export type VaultReceipt = z.infer<typeof VaultReceipt>;
