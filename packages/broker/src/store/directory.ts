import { Address, Category, ContactTag, type AgentContacts, type Contact } from "@team-31/protocol";

export function directoryContact(row: {
  address: string; name?: string | null; tag?: string | null; gives: string[]; receives: string[];
}): Contact {
  return {
    address: Address.parse(row.address),
    ...(row.name ? { displayName: row.name } : {}),
    ...(row.tag ? { tag: ContactTag.parse(row.tag) } : {}),
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
