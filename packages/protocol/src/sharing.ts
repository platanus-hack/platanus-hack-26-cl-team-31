import { z } from "zod";
import { Category } from "./categories.js";
import { contactTagNames } from "./constants.js";

// The categories a holder gives a contact.
export const Sharing = z.array(Category);
export type Sharing = z.infer<typeof Sharing>;

// What a new contact gets unless the holder chooses otherwise, and what the members of a circle give each other.
export const basicSharing: Sharing = ["availability", "interests"];

// A tag groups contacts that get the same sharing. Changing a tag's preset updates every contact
// with that tag that still matches the old preset; a contact edited by hand keeps its own sharing.
export const ContactTag = z.enum(contactTagNames);
export type ContactTag = z.infer<typeof ContactTag>;

export { contactTags } from "./constants.js";

export const TagPresets = z.object({ friend: Sharing, family: Sharing, work: Sharing });
export type TagPresets = z.infer<typeof TagPresets>;
