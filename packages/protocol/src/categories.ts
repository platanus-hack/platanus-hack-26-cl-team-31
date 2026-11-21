import { z } from "zod";
import { categoryNames } from "./constants.js";

export { categories } from "./constants.js";

export const Category = z.enum(categoryNames);
export type Category = z.infer<typeof Category>;
