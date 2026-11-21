import { z } from "zod";
import { Address } from "./address.js";
import { Category } from "./categories.js";
import { Tag, TagColor, TagId, TagName } from "./sharing.js";

export { defaultVaultCategories } from "./constants.js";

const name = z.string().trim().min(1).max(80);
const description = z.string().trim().max(280);
// Default categories keep the catalog ids. Every other category gets a UUID.
const categoryId = z.union([z.uuid(), Category]);
const value = z.union([z.string().trim().min(1).max(2000), z.number(), z.boolean()]);
const documentId = z.uuid();
const fileName = z.string().min(1).max(255).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "El nombre del archivo contiene caracteres no permitidos.");
const mimeType = z.string().min(1).max(255);
const idempotencyKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
// JSON/base64 is deliberately used at the MCP boundary so the broker remains transport agnostic.
// Five MiB keeps a single tool call within the limits of the deployed HTTP stack.
export const MAX_VAULT_DOCUMENT_BYTES = 5 * 1024 * 1024;
const maxBase64Length = Math.ceil(MAX_VAULT_DOCUMENT_BYTES / 3) * 4;
const contentBase64 = z.base64().max(maxBase64Length);
export const VaultEntry = z.object({ label: name, value });
export const VaultCategory = z.object({ id: categoryId, name, description: description.optional() });
const categorySharing = VaultCategory.extend({ tags: z.array(TagId) });
export const VaultMembersQuery = z.strictObject({ categoryId });
export const VaultMembers = z.object({ members: z.array(Address) });
// The holder's own catalog. Entries and members come only when a single category is requested.
export const VaultCatalogQuery = z.strictObject({ categoryId: categoryId.optional() });
export const VaultCatalog = z.object({ categories: z.array(categorySharing.extend({
  entries: z.array(VaultEntry).optional(),
  members: VaultMembers.shape.members.optional(),
})) });
export type VaultCatalog = z.infer<typeof VaultCatalog>;
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
export const VaultDocumentMetadata = z.object({
  id: documentId,
  fileName,
  mimeType: mimeType.optional(),
  sizeBytes: z.number().int().nonnegative().max(MAX_VAULT_DOCUMENT_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime({ offset: true }),
});
export type VaultDocumentMetadata = z.infer<typeof VaultDocumentMetadata>;

export const VaultDocumentUpload = z.strictObject({
  categoryId,
  fileName,
  mimeType: mimeType.optional(),
  contentBase64,
  idempotencyKey,
});
export type VaultDocumentUpload = z.infer<typeof VaultDocumentUpload>;

export const VaultDocumentQuery = z.strictObject({
  to: Address,
  categoryId,
  documentId,
});
export type VaultDocumentQuery = z.infer<typeof VaultDocumentQuery>;

export const VaultDocumentDownload = VaultDocumentMetadata.extend({ contentBase64 });
export type VaultDocumentDownload = z.infer<typeof VaultDocumentDownload>;

export const VaultDocumentList = z.array(VaultDocumentMetadata);

export const VaultResult = z.object({
  categories: z.array(VaultCategory.extend({
    entries: z.array(VaultEntry).optional(),
    documents: VaultDocumentList.optional(),
  })),
});
export type VaultResult = z.infer<typeof VaultResult>;
export const VaultChange = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), name }),
  z.strictObject({ action: z.literal("rename"), categoryId, name }),
  z.strictObject({ action: z.literal("describe"), categoryId, description }),
  z.strictObject({ action: z.literal("delete"), categoryId }),
  z.strictObject({ action: z.literal("put_entry"), categoryId, ...VaultEntry.shape }),
  z.strictObject({ action: z.literal("delete_entry"), categoryId, label: name }),
  z.strictObject({ action: z.literal("set_tag"), categoryId, tagId: TagId, allowed: z.boolean() }),
  z.strictObject({ action: z.literal("set_member"), categoryId, address: Address, allowed: z.boolean() }),
]);
export type VaultChange = z.infer<typeof VaultChange>;
export const VaultReceipt = z.object({ categoryId });
export type VaultReceipt = z.infer<typeof VaultReceipt>;
