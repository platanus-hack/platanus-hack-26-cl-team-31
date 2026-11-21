import { z } from "zod";
import { Category } from "./categories.js";
import { tagColors } from "./constants.js";

// The categories a holder gives a contact.
export const Sharing = z.array(Category);
export type Sharing = z.infer<typeof Sharing>;

// What a new contact gets unless the holder chooses otherwise, and what the members of a circle give each other.
export const basicSharing: Sharing = ["availability", "interests"];

export const TagId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const TagName = z.string().trim().min(1).max(80);
export const TagColor = z.enum(tagColors);
export type TagColor = z.infer<typeof TagColor>;
export const TagIds = z.array(TagId).max(50).transform((ids) => [...new Set(ids)]);

export const Tag = z.object({ id: TagId, name: TagName, color: TagColor, categories: Sharing });
export type Tag = z.infer<typeof Tag>;
export const TagInput = z.strictObject({ name: TagName, color: TagColor.optional(), categories: Sharing.optional() });
export type TagInput = z.input<typeof TagInput>;
export const TagUpdate = z.strictObject({ name: TagName.optional(), color: TagColor.optional(), categories: Sharing.optional() });
export type TagUpdate = z.input<typeof TagUpdate>;

export { defaultTags, tagColors, tagSharing } from "./constants.js";
