import { Address, Category, categories } from "@team-31/protocol";
import type { Intent, Field, InterpretMessage, Selector, TurnState } from "./types.js";
import { normalized, selectChoice } from "./recipients.js";

const literalAddresses = (text: string): readonly string[] => text.match(/[a-z0-9._+%-]+@[a-z0-9.-]+[a-z0-9]/g) ?? [];

// Only bounded literal references are eligible. A suffix of an address or a name is not a new identity.
function includesLiteral(text: string, value: string) {
  if (value.includes("@")) return literalAddresses(text).includes(normalized(value));
  const key = normalized(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alphabet = "\\p{L}\\p{N}";
  return new RegExp("(?<![" + alphabet + "])" + key + "(?![" + alphabet + "])", "u").test(text);
}

type Ask = Extract<Intent, { action: "ask" }>;
type TargetIntent = Extract<Intent, { action: "ask" | "vault" }>;

function targetIntent(intent: Intent): intent is TargetIntent {
  return intent.action === "ask" || intent.action === "vault";
}

const scopeTerms = {
  friend: /\b(?:mi |mis |my |entre |between )(?:amig[oa]s?|friends?)\b/,
  family: /\b(?:mi |mis |my |de la )(?:familia(?:r(?:es)?)?|family)\b/,
  work: /\b(?:mis? |my )(?:colegas?|companeros? de trabajo|contactos? de trabajo|coworkers?)\b/,
  circle: /\b(?:circulo|circle)\b/,
  contacts: /\b(?:mis? contactos?|my contacts?)\b/,
} as const;
function explicitScope(text: string) {
  const single: Record<string, keyof typeof scopeTerms> = { amigos: "friend", familia: "family", trabajo: "work", contactos: "contacts", circulo: "circle" };
  if (single[text]) return single[text];
  return (Object.keys(scopeTerms) as (keyof typeof scopeTerms)[]).find(scope => scopeTerms[scope].test(text));
}
const ownVaultTerms = /\b(?:bovedas?|vaults?|categorias?|guard\w*|saved?|stored?)\b/;
const collective = /\b(alguien|todos|todas|todo el|toda mi|integrantes|miembros|anyone|everyone|all|members|mis amig[oa]s|mis contactos|mis colegas|mis familiares|my friends|my contacts)\b/;

// A missing optional reference needs no match. A supplied one must occur in the holder's text.
function statedReference(text: string, value?: string) {
  return !value || includesLiteral(text, value);
}

function groundedRead(intent: Exclude<Intent, TargetIntent>, text: string): Intent {
  switch (intent.action) {
    case "status":
      if (!statedReference(text, intent.requestId) || !statedReference(text, intent.recipient)) return { action: "clarify" };
      return intent;
    case "profiles":
      if (!/\b(perfil(?:es)?|profiles?)\b/.test(text) ||
          !/\b(public[oa]s?|public|busc\w*|encuentr\w*|search|find)\b/.test(text) ||
          !statedReference(text, intent.query)) return { action: "clarify" };
      return intent;
    case "own_vault":
      if (!ownVaultTerms.test(text)) return { action: "clarify" };
      // A name the holder did not write lists the categories instead of opening one.
      if (!statedReference(text, intent.categoryName)) delete intent.categoryName;
      return intent;
    default:
      return intent;
  }
}

function groundAddress(selector: Selector, text: string) {
  if (selector.count !== "one") return false;
  if (!selector.person) {
    const addresses = literalAddresses(text);
    if (addresses.length !== 1) return false;
    selector.person = addresses[0]!;
  }
  return Address.safeParse(normalized(selector.person)).success;
}

function groundSelector(selector: Selector, text: string, statedScope: ReturnType<typeof explicitScope>) {
  if (statedScope && selector.scope !== statedScope) return false;
  if (!statedReference(text, selector.person) || !statedReference(text, selector.circle)) return false;
  if (selector.scope === "address") return groundAddress(selector, text);
  if (selector.count === "one") {
    if (selector.person && selector.scope === "unspecified") selector.scope = "contacts";
    return true;
  }
  if (!collective.test(text) || selector.person) return false;
  if (!statedScope) selector.scope = "unspecified";
  return true;
}

const inviteTerms = /\b(?:invita\w*|conect\w*|agrega\w*|invite|connect|add)\b/;
const sharingClause = /\b(?:comparte(?:le)?|compartir(?:le)?|compartiendole|share)\s+(?:solo |only )?(.+?)\s*[.!?]*$/;
const sharingTerms = /\b(compart\w*|shar\w*)\b/;
const negationTerms = /\b(no|sin|excepto|except|don't|without)\b/;

function groundedInvitation(intent: Ask, text: string): Intent {
  if (!inviteTerms.test(text)) return { action: "clarify" };
  const sharing = sharingClause.exec(text);
  if (!sharing) {
    if (intent.args.share || sharingTerms.test(text)) return { action: "clarify" };
    return intent;
  }
  const share = parseSharingCategories(sharing[1]!);
  if (!share || negationTerms.test(text.slice(0, sharing.index))) return { action: "clarify" };
  intent.args.share = share;
  return intent;
}

function groundedAsk(intent: Ask, text: string, source: string): Intent {
  switch (intent.tool) {
    case "connect":
      return groundedInvitation(intent, text);
    case "question":
      if (!statedReference(text, intent.args.text)) intent.args.text = source.length <= 1000 ? source : undefined;
      return intent;
    case "interest_check":
      if (!statedReference(text, intent.args.interest)) delete intent.args.interest;
      return intent;
    case "vault_access":
      if (!statedReference(text, intent.args.categoryName)) delete intent.args.categoryName;
      return intent;
    default:
      return intent;
  }
}

export function grounded(intent: Intent, source: string): Intent {
  const text = normalized(source);
  const scope = explicitScope(text);
  if (!targetIntent(intent)) {
    if (scope && !(scope === "contacts" && intent.action === "contacts")) return { action: "clarify" };
    return groundedRead(intent, text);
  }
  const { selector } = intent;
  // A vault read can adopt the narrower set the holder named.
  if (scope && intent.action === "vault" && selector.scope === "unspecified") selector.scope = scope;
  if (!groundSelector(selector, text, scope)) return { action: "clarify" };
  if (intent.action === "ask") return groundedAsk(intent, text, source);

  // Reading a vault notifies no one and returns only what each contact shares.
  if (selector.scope === "address" || selector.scope === "unspecified") selector.scope = "contacts";
  return intent;
}

export function parseSharingCategories(text: string): Category[] | undefined {
  const words = normalized(text).replace(/[.!?]+$/, "");
  if (/^(nada|ninguna|none|nothing)$/.test(words)) return [];
  const terms = new Map<string, Category>();
  for (const category of Category.options) {
    terms.set(category, category);
    terms.set(normalized(categories[category].label), category);
  }
  terms.set("disponibilidad", "availability");
  const result: Category[] = [];
  for (const part of words.split(/\s*,\s*|\s+(?:y|and)\s+/)) {
    const category = terms.get(part);
    if (!category) return;
    if (!result.includes(category)) result.push(category);
  }
  return result;
}

type Pending = Extract<TurnState, { phase: "clarify" }>;
export type Selection = { intent: Intent; invitationTag?: string | null; circleId?: string; categoryId?: string };
const slotFields = new Set<Field>(["text", "category", "date", "start", "durationMinutes", "timezone", "interest", "share", "categoryName"]);

function selectVaultCategory(keep: Selection, value: string, option?: string): Selection | undefined {
  const { intent } = keep;
  if (intent.action !== "vault" && intent.action !== "own_vault") return;
  // Multi-contact reads match a category name across catalogs. IDs are local to one holder.
  const byName = intent.action === "vault" && intent.selector.count === "many";
  if (option && !byName) return { ...keep, categoryId: option };
  intent.categoryName = value;
  return keep;
}

function directSelection(field: Field, keep: Selection, text: string, option?: string): Selection | undefined {
  const { intent } = keep;
  const value = option ?? text.trim();
  switch (field) {
    case "invitationTag":
      return { ...keep, invitationTag: option === "none" ? null : option };
    case "person":
      if (!targetIntent(intent)) return;
      intent.selector.person = value;
      return keep;
    case "circle":
      if (!targetIntent(intent)) return;
      if (option) return { intent, circleId: option };
      intent.selector.circle = value;
      return { intent };
    case "requestId":
      if (intent.action !== "status") return;
      intent.requestId = value;
      return keep;
    case "query":
      if (intent.action !== "profiles") return;
      intent.query = value;
      return keep;
    case "categoryId":
      return selectVaultCategory(keep, value, option);
    default:
      return undefined;
  }
}

function interpretationDraft(intent: Intent): TargetIntent | undefined {
  if (!targetIntent(intent)) return;
  const { scope, count } = intent.selector;
  const selector = { scope, count };
  if (intent.action === "ask") return { ...intent, selector, args: {} };
  return { ...intent, selector };
}

function applyScope(intent: TargetIntent, candidate: Selector, text: string) {
  if (explicitScope(text) !== candidate.scope || !statedReference(text, candidate.circle)) return;
  intent.selector = { ...intent.selector, scope: candidate.scope, circle: candidate.circle };
}

function applyAskField(intent: Ask, answer: Ask, key: keyof Ask["args"], text: string) {
  if (intent.tool !== answer.tool) return;
  const slot = answer.args[key];
  if (slot === undefined) return;
  if ((key === "text" || key === "interest") && !(typeof slot === "string" && includesLiteral(text, slot))) return;
  Object.assign(intent.args, { [key]: slot });
}

export async function continueIntent(text: string, previous: Pending, interpret: InterpretMessage): Promise<Selection> {
  const { field, at, timezone, circleId, invitationTag } = previous;
  const intent = structuredClone(previous.intent);
  const keep = { intent, circleId, invitationTag };
  const direct = directSelection(field, keep, text, selectChoice(text, previous.choices ?? []));
  if (direct) return direct;

  const answer = await interpret(text, { at, timezone, expected: field, draft: interpretationDraft(intent) });
  if (field === "intent") return { intent: grounded(answer, text) };
  if (field === "scope" && targetIntent(intent) && targetIntent(answer)) {
    applyScope(intent, answer.selector, normalized(text));
  } else if (slotFields.has(field) && intent.action === "ask" && answer.action === "ask") {
    applyAskField(intent, answer, field as keyof Ask["args"], normalized(text));
  }
  return keep;
}
