import { Address, type AgentContacts } from "@team-31/protocol";
import type { Choice, Field, Relation, Selector } from "./types.js";

export function normalized(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

export function matchesPerson(person: string, address: string, displayName?: string) {
  const key = normalized(person);
  if (key.includes("@")) return key === address;
  const name = normalized(displayName ?? "");
  return address.split("@")[0]!.split(/[._-]/).includes(key) || key === address.split("@")[0] || key === name || name.split(/\s+/).includes(key);
}

export type Prompt = { field: Field; question: string; choices?: Choice[] };
type Resolution =
  | { kind: "resolved"; targets: string[]; relation?: Relation }
  | { kind: "clarify"; prompt: Prompt }
  | { kind: "unsupported" }
  | { kind: "empty" };

export async function resolveRecipients(
  selector: Selector, contacts: () => Promise<AgentContacts>, selectedCircle?: string, mustBeContact = false,
): Promise<Resolution> {
  const { scope, person, count } = selector;
  if (scope === "unspecified") {
    return { kind: "clarify", prompt: { field: "scope", question: "¿Entre tus contactos, tus amigos o algún círculo?" } };
  }
  if (scope === "address") {
    const address = Address.safeParse(person?.toLowerCase());
    if (!address.success || count !== "one") {
      return { kind: "clarify", prompt: { field: "person", question: "¿Cuál es la dirección Sideband de la persona?" } };
    }
    return { kind: "resolved", targets: [address.data] };
  }
  const directory = await contacts();
  let members: string[];
  let relation: Relation;
  const names = new Map(directory.contacts.map(contact => [contact.address, contact.displayName]));
  if (scope === "circle") {
    const circles = directory.circles.filter(c => selectedCircle ? c.id === selectedCircle : selector.circle && normalized(c.name) === normalized(selector.circle));
    const circle = circles[0];
    if (circles.length !== 1 || !circle) {
      const options = selector.circle ? circles : directory.circles;
      return { kind: "clarify", prompt: { field: "circle", question: "¿A qué círculo te refieres?",
        choices: options.filter(c => c.id).map(c => ({ value: c.id!, label: c.name + (circles.length > 1 ? " (" + c.members.length + " integrantes, " + c.id!.slice(-6) + ")" : "") })) } };
    }
    if (!circle.id) return { kind: "unsupported" };
    members = mustBeContact ? circle.members.filter(address => names.has(address)) : circle.members;
    for (const [address, name] of Object.entries(circle.memberNames ?? {})) names.set(address, name);
    relation = { kind: "circle", circleId: circle.id };
  } else {
    const tag = scope === "contacts" ? undefined : scope;
    members = directory.contacts.filter(contact => !tag || contact.tags.includes(tag)).map(contact => contact.address);
    relation = tag ? { kind: "contact", tag } : { kind: "contact" };
  }
  const candidates = [...new Set(members)].filter(to => !person || matchesPerson(person, to, names.get(to)));
  if (count === "many") return candidates.length ? { kind: "resolved", targets: candidates, relation } : { kind: "empty" };
  if (candidates.length === 1 && person) return { kind: "resolved", targets: candidates, relation };
  const choices = candidates.map(value => ({ value, label: value }));
  const namesOfScopes = { contacts: "tus contactos", friend: "tus amigos", family: "tu familia", work: "tus contactos de trabajo", circle: "ese círculo" };
  const question = choices.length ? "¿A qué persona te refieres?" : "No encontré a esa persona entre " + namesOfScopes[scope] + ". ¿Qué dirección Sideband usa?";
  return { kind: "clarify", prompt: { field: "person", question, choices } };
}

const ordinals = ["primera", "segunda", "tercera", "cuarta", "quinta", "sexta", "septima", "octava", "novena", "decima"];
export function selectChoice(text: string, choices: Choice[]) {
  const key = normalized(text);
  const direct = choices.filter(c => normalized(c.value) === key || normalized(c.label) === key);
  if (direct.length === 1) return direct[0]?.value;
  const number = /^(?:(?:la |el )?(?:opcion |numero )?)?(\d+)$/.exec(key);
  const word = key.replace(/^(?:la |el )/, "").replace(/o$/, "a");
  const index = number ? Number(number[1]) - 1 : ordinals.indexOf(word);
  return choices[index]?.value;
}
