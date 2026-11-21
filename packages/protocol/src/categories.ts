import { z } from "zod";
import type { ToolName } from "./tools.js";

export const Category = z.enum(["availability", "interests", "health", "general"]);
export type Category = z.infer<typeof Category>;

// A category is what the information is about; a tool is how it is asked. A holder grants
// categories, and a grant covers every tool and result field of its category.
export const categories: Record<Category, { label: string; tools: readonly ToolName[] }> = {
  availability: { label: "Disponibilidad horaria", tools: ["availability", "question"] },
  interests: { label: "Intereses", tools: ["interest_check", "question"] },
  health: { label: "Salud", tools: ["question"] },
  general: { label: "Preguntas abiertas", tools: ["question"] },
};
