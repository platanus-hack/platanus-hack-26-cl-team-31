import { z } from "zod";
import { Category } from "./categories.js";

// The categories a holder gives a contact.
export const Sharing = z.array(Category);
export type Sharing = z.infer<typeof Sharing>;

// What a new contact gets unless the holder chooses otherwise, and what the members of a circle give each other.
export const basicSharing: Sharing = ["availability", "interests"];
