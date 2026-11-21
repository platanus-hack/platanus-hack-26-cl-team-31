import { z } from "zod";
import { Address } from "./address.js";
import { Tag, TagColor, TagId, TagName } from "./sharing.js";

const name = z.string().trim().min(1).max(80);
const categoryId = z.uuid();
const value = z.union([z.string().trim().min(1).max(2000), z.number(), z.boolean()]);
export const VaultEntry = z.object({ label: name, value });
export const VaultCategory = z.object({ id: categoryId, name });
const categorySharing = VaultCategory.extend({ tags: z.array(TagId) });
export const VaultCatalog = z.object({ categories: z.array(categorySharing) });
export type VaultCatalog = z.infer<typeof VaultCatalog>;
export const VaultMembersQuery = z.strictObject({ categoryId });
export const VaultMembers = z.object({ members: z.array(Address) });
export const TagsView = z.object({ tags: z.array(Tag.extend({ members: z.array(Address) })) });
export type TagsView = z.infer<typeof TagsView>;
export const TagChange = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), name: TagName, color: TagColor.optional() }),
  z.strictObject({ action: z.literal("update"), tagId: TagId, name: TagName.optional(), color: TagColor.optional() }),
  z.strictObject({ action: z.literal("delete"), tagId: TagId }),
  z.strictObject({ action: z.literal("add_contact"), tagId: TagId, address: Address }),
  z.strictObject({ action: z.literal("remove_contact"), tagId: TagId, address: Address }),
]);
export type TagChange = z.infer<typeof TagChange>;
export const TagReceipt = z.object({ tagId: TagId });
export const OwnerVault = z.object({ categories: z.array(categorySharing.extend({
  entries: z.array(VaultEntry),
  members: VaultMembers.shape.members.optional(),
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
  z.strictObject({ action: z.literal("set_tag"), categoryId, tagId: TagId, allowed: z.boolean() }),
  z.strictObject({ action: z.literal("set_member"), categoryId, address: Address, allowed: z.boolean() }),
]);
export type VaultChange = z.infer<typeof VaultChange>;
export const VaultReceipt = z.object({ categoryId });
export type VaultReceipt = z.infer<typeof VaultReceipt>;
