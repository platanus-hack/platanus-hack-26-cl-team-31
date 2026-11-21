import type { ToolName } from "./tools.js";

// Plain values without zod, so client components can import them (`@team-31/protocol/constants`)
// without shipping the schemas. The schemas in categories.ts and sharing.ts are built from them.

export const ADDRESS_DOMAIN = "sideband.app";

export const categoryNames = ["availability", "interests", "health", "general"] as const;
export type Category = (typeof categoryNames)[number];

// A category is what the information is about; a tool is how it is asked. A holder grants
// categories, and a grant covers every tool and result field of its category.
export const categories: Record<Category, { label: string; tools: readonly ToolName[] }> = {
  availability: { label: "Disponibilidad horaria", tools: ["availability", "question"] },
  interests: { label: "Intereses", tools: ["interest_check", "question"] },
  health: { label: "Salud", tools: ["question"] },
  general: { label: "Preguntas abiertas", tools: ["question"] },
};

export const contactTagNames = ["friend", "family", "work"] as const;
export type ContactTag = (typeof contactTagNames)[number];

export const contactTags: Record<ContactTag, { label: string; sharing: Category[] }> = {
  friend: { label: "Amigo", sharing: ["availability", "interests"] },
  family: { label: "Familia", sharing: ["availability", "interests", "health", "general"] },
  work: { label: "Trabajo", sharing: ["availability"] },
};
