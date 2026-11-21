import { z } from "zod";
import { Category } from "./categories.js";

// The categories a holder gives a contact.
export const Sharing = z.array(Category);
export type Sharing = z.infer<typeof Sharing>;

// What a new contact gets unless the holder chooses otherwise, and what the members of a circle give each other.
export const basicSharing: Sharing = ["availability", "interests"];

// A tag groups contacts that get the same sharing. Changing a tag's preset updates every contact
// with that tag that still matches the old preset; a contact edited by hand keeps its own sharing.
export const ContactTag = z.enum(["friend", "family", "work"]);
export type ContactTag = z.infer<typeof ContactTag>;

export const contactTags: Record<ContactTag, { label: string; sharing: Sharing }> = {
  friend: { label: "Amigo", sharing: ["availability", "interests"] },
  family: { label: "Familia", sharing: ["availability", "interests", "health", "general"] },
  work: { label: "Trabajo", sharing: ["availability"] },
};

export const TagPresets = z.object({ friend: Sharing, family: Sharing, work: Sharing });
export type TagPresets = z.infer<typeof TagPresets>;
