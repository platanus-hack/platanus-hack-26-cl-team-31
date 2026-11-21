import { categories, Category, type Sharing } from "@team-31/protocol";

export function describeSharing(sharing: Sharing): string {
  if (sharing.length === 0) return "Nada";
  return Category.options.filter((category) => sharing.includes(category)).map((category) => categories[category].label).join(" · ");
}
