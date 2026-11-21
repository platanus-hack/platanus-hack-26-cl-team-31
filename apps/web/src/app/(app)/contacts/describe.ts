import type { Sharing } from "@team-31/protocol";
import { categories, categoryNames } from "@team-31/protocol/constants";

export function describeSharing(sharing: Sharing): string {
  if (sharing.length === 0) return "Nada";
  return categoryNames.filter((category) => sharing.includes(category)).map((category) => categories[category].label).join(" · ");
}
