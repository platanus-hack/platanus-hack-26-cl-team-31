import { Address, Category, defaultTags, type AgentContacts, type Contact, type Tag } from "@team-31/protocol";

export function directoryContact(row: {
  address: string; name?: string | null; tags?: readonly string[] | null; gives: string[]; receives: string[];
}): Contact {
  return {
    address: Address.parse(row.address),
    ...(row.name ? { displayName: row.name } : {}),
    tags: [...(row.tags ?? [])].sort(),
    // The protocol catalog sets the order for both stores, independent of grant creation time.
    gives: Category.options.filter(category => row.gives.includes(category)),
    receives: Category.options.filter(category => row.receives.includes(category)),
  };
}

// Input rows include empty joined circles, in circle creation order and then address order.
export function directoryCircles(rows: Iterable<{
  id: string; circleName: string; address?: string | null; memberName?: string | null;
}>): AgentContacts["circles"] {
  const circles = new Map<string, AgentContacts["circles"][number]>();
  for (const row of rows) {
    let circle = circles.get(row.id);
    if (!circle) {
      circle = { id: row.id, name: row.circleName, members: [] };
      circles.set(row.id, circle);
    }
    if (row.address) {
      const address = Address.parse(row.address);
      circle.members.push(address);
      if (row.memberName) (circle.memberNames ??= {})[address] = row.memberName;
    }
  }
  return [...circles.values()];
}

export function normalizeSearch(input: string) {
  return input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export const publicProfileLimit = 25;

const defaultOrder = defaultTags.map((tag) => tag.id);

export function sortTags<T extends Pick<Tag, "id" | "name">>(tags: T[]): T[] {
  const rank = (tag: T) => {
    const index = defaultOrder.indexOf(tag.id);
    return index < 0 ? defaultOrder.length : index;
  };
  return tags.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function seededTags(): Tag[] {
  return defaultTags.map((tag) => ({ ...tag, categories: [...tag.categories] }));
}
