import { Address, Category, categories } from "@team-31/protocol";
import type { Intent, Field, InterpretMessage, TurnState } from "./types.js";
import { normalized, selectChoice } from "./recipients.js";

// Only bounded literal references are eligible. A suffix of an address or a name is not a new identity.
const includesLiteral = (source: string, value: string) => {
  const key = normalized(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alphabet = value.includes("@") ? "a-z0-9@._-" : "\\p{L}\\p{N}";
  return new RegExp("(?<![" + alphabet + "])" + key + "(?![" + alphabet + "])", "u").test(normalized(source));
};
const targetIntent = (draft: Intent) => draft.action === "ask" || draft.action === "vault";
const scopeTerms = {
  friend: /\b(?:mi |mis |my |entre |between )(?:amig[oa]s?|friends?)\b/,
  family: /\b(?:mi |mis |my |de la )(?:familia(?:r(?:es)?)?|family)\b/,
  work: /\b(?:mis? |my )(?:colegas?|companeros? de trabajo|contactos? de trabajo|coworkers?)\b/,
  circle: /\b(?:circulo|circle)\b/,
  contacts: /\b(?:mis? contactos?|my contacts?)\b/,
} as const;
function explicitScope(source: string) {
  const text = normalized(source);
  const single: Record<string, keyof typeof scopeTerms> = { amigos: "friend", familia: "family", trabajo: "work", contactos: "contacts", circulo: "circle" };
  if (single[text]) return single[text];
  return (Object.keys(scopeTerms) as (keyof typeof scopeTerms)[]).find(scope => scopeTerms[scope].test(text));
}
const collective = /\b(alguien|todos|todas|todo el|toda mi|integrantes|miembros|anyone|everyone|all|members|mis amig[oa]s|mis contactos|mis colegas|mis familiares|my friends|my contacts)\b/;

export function grounded(intent: Intent, source: string): Intent {
  const text = normalized(source);
  const statedScope = explicitScope(source);
  if (statedScope === "contacts" && intent.action === "contacts") return intent;
  if (statedScope && (!targetIntent(intent) || intent.selector.scope !== statedScope)) return { action: "clarify" };
  if (!targetIntent(intent)) {
    if (intent.action === "status" && ((intent.requestId && !includesLiteral(source, intent.requestId)) ||
      (intent.recipient && !includesLiteral(source, intent.recipient)))) return { action: "clarify" };
    if (intent.action === "profiles" && (!/\b(perfil(?:es)?|profiles?)\b/.test(text) ||
      !/\b(public[oa]s?|public|busc\w*|encuentr\w*|search|find)\b/.test(text) ||
      intent.query && !includesLiteral(source, intent.query))) return { action: "clarify" };
    return intent;
  }
  const { selector } = intent;
  if ([selector.person, selector.circle].some(value => value && !includesLiteral(source, value))) return { action: "clarify" };
  if (selector.scope === "address" && (!selector.person || !Address.safeParse(normalized(selector.person)).success)) return { action: "clarify" };
  if (selector.count === "many" && (!collective.test(text) || selector.person)) return { action: "clarify" };
  if (selector.count === "many" && !statedScope) selector.scope = "unspecified";
  if (intent.action === "ask") {
    if (intent.tool === "question" && intent.args.text && !includesLiteral(source, intent.args.text)) intent.args.text = source.length <= 1000 ? source : undefined;
    if (intent.tool === "interest_check" && intent.args.interest && !includesLiteral(source, intent.args.interest)) delete intent.args.interest;
    if (intent.tool === "connect") {
      if (!/\b(?:invita\w*|conect\w*|agrega\w*|invite|connect|add)\b/.test(text)) return { action: "clarify" };
      const sharing = /\b(?:comparte(?:le)?|compartir(?:le)?|compartiendole|share)\s+(?:solo |only )?(.+?)\s*[.!?]*$/.exec(text);
      if (sharing) {
        const categories = parseSharingCategories(sharing[1]!);
        if (!categories || /\b(no|sin|excepto|except|don't|without)\b/.test(text.slice(0, sharing.index))) return { action: "clarify" };
        intent.args.share = categories;
      } else if (intent.args.share || /\b(compart\w*|shar\w*)\b/.test(text)) return { action: "clarify" };
    }
  }
  if (intent.action === "vault") {
    selector.count = "one";
    if (selector.scope === "address" || selector.scope === "unspecified") selector.scope = "contacts";
  }
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
export type Selection = { intent: Intent; circleId?: string; categoryId?: string };
const slotFields = new Set<Field>(["text", "category", "date", "start", "durationMinutes", "timezone", "interest", "share"]);

export async function continueIntent(text: string, previous: Pending, interpret: InterpretMessage): Promise<Selection> {
  const { field, at, timezone } = previous;
  const intent = structuredClone(previous.intent);
  const option = selectChoice(text, previous.choices ?? []);
  const value = option ?? text.trim();
  const keep = { intent, circleId: previous.circleId };
  if (field === "person" && targetIntent(intent)) {
    intent.selector.person = value;
    return keep;
  }
  if (field === "circle" && targetIntent(intent)) {
    if (option) return { intent, circleId: option };
    intent.selector.circle = value;
    return { intent };
  }
  if (field === "requestId" && intent.action === "status") {
    intent.requestId = value;
    return keep;
  }
  if (field === "query" && intent.action === "profiles") { intent.query = value; return keep; }
  if (field === "categoryId" && intent.action === "vault") {
    if (option) return { ...keep, categoryId: option };
    intent.categoryName = value;
    return keep;
  }
  const modelDraft = targetIntent(intent) ? { ...intent, selector: { scope: intent.selector.scope, count: intent.selector.count } } : undefined;
  if (modelDraft?.action === "ask") modelDraft.args = {};
  const answer = await interpret(text, { at, timezone, expected: field, draft: modelDraft });
  if (field === "intent") return { intent: grounded(answer, text) };
  if (field === "scope" && targetIntent(intent) && targetIntent(answer)) {
    const candidate = answer.selector;
    if (!explicitScope(text) || explicitScope(text) !== candidate.scope || candidate.circle && !includesLiteral(text, candidate.circle)) return keep;
    intent.selector = { ...intent.selector, scope: candidate.scope, circle: candidate.circle };
  }
  if (slotFields.has(field) && intent.action === "ask" && answer.action === "ask" && intent.tool === answer.tool) {
    const key = field as keyof typeof intent.args;
    const slot = answer.args[key];
    if (slot !== undefined && (key !== "text" && key !== "interest" || typeof slot === "string" && includesLiteral(text, slot))) {
      Object.assign(intent.args, { [key]: slot });
    }
  }
  return keep;
}
