// Plain values without zod, so client components can import them (`@team-31/protocol/constants`)
// without shipping the schemas. The schemas for categories, tags and tools are built from them.

export const ADDRESS_DOMAIN = "sideband.app";

export const toolNames = ["profile", "availability", "question", "interest_check", "connect", "vault_access"] as const;
type ToolName = (typeof toolNames)[number];

export const categoryNames = ["availability", "interests", "health", "general"] as const;
export type Category = (typeof categoryNames)[number];

export function sameSharing(a: readonly Category[], b: readonly Category[]): boolean {
  return a.every((category) => b.includes(category)) && b.every((category) => a.includes(category));
}

// A category is what the information is about; a tool is how it is asked. A holder grants
// categories, and a grant covers every tool and result field of its category.
export const categories: Record<Category, { label: string; tools: readonly ToolName[] }> = {
  availability: { label: "Disponibilidad horaria", tools: ["availability", "question"] },
  interests: { label: "Intereses", tools: ["interest_check", "question"] },
  health: { label: "Salud", tools: ["question"] },
  general: { label: "Preguntas abiertas", tools: ["question"] },
};

// Every holder starts with one vault category per catalog category, under the same id.
export const defaultVaultCategories: readonly { id: Category; name: string; description: string }[] = [
  { id: "availability", name: categories.availability.label, description: "Tus horarios y cuándo estás libre." },
  { id: "interests", name: categories.interests.label, description: "Lo que te gusta y los temas que te interesan." },
  { id: "health", name: categories.health.label, description: "Alergias, tratamientos y contactos médicos." },
  { id: "general", name: categories.general.label, description: "Lo que no entra en otra categoría." },
];

export const tagColors =["emerald", "amber", "violet", "sky", "rose", "slate"] as const;
export type TagColor = (typeof tagColors)[number];

export const defaultTags: readonly { id: string; name: string; color: TagColor; categories: readonly Category[] }[] = [
  { id: "friend", name: "Amigo", color: "emerald", categories: ["availability", "interests"] },
  { id: "family", name: "Familia", color: "amber", categories: ["availability", "interests", "health", "general"] },
  { id: "work", name: "Trabajo", color: "violet", categories: ["availability"] },
];

export function tagSharing(tags: readonly { id: string; categories: readonly Category[] }[], ids: readonly string[]): Category[] {
  const chosen = tags.filter((tag) => ids.includes(tag.id));
  return categoryNames.filter((category) => chosen.some((tag) => tag.categories.includes(category)));
}
