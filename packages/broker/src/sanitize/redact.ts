import { BrokerError } from "../errors.js";
import { containsHint, skeletonTokens } from "./text.js";
import { addFlags, asRecord, type Redactor, type Stage } from "./types.js";

/** Default: returns the text unchanged. */
export const identityRedactor: Redactor = {
  async redact({ text }) {
    return { text };
  },
};

export const REDACTED = "[redactado]";

/**
 * Deterministic test double: replaces every whitespace-delimited word run that matches a private hint
 * with `[redactado]`. Not a security control on its own — leak-guard still runs after it.
 */
export function createFakeRedactor(): Redactor {
  return {
    async redact({ text, privateHints }) {
      let out = text;
      for (const hint of privateHints) {
        const size = Math.max(1, skeletonTokens(hint).length);
        const words = out.split(/(\s+)/);
        const result: string[] = [];
        for (let i = 0; i < words.length; i += 1) {
          // Smallest window that starts at word i and contains the hint ("Dr. Soto" → one unit).
          let replaced = false;
          const maxSpan = Math.min(words.length - i, size * 2 + 1);
          for (let span = 1; span <= maxSpan; span += 1) {
            const chunk = words.slice(i, i + span).join("");
            const rest = words.slice(i + 1, i + span).join("");
            if (chunk.trim() && containsHint(chunk, hint) && !containsHint(rest, hint)) {
              result.push(REDACTED);
              i += span - 1;
              replaced = true;
              break;
            }
          }
          if (!replaced) result.push(words[i]!);
        }
        out = result.join("");
      }
      return { text: out };
    },
  };
}

/** Free-text fields the redactor may rewrite, per tool. */
const REDACTABLE: Partial<Record<string, string>> = { question: "answer" };

export const redact: Stage = async (state, ctx) => {
  const field = REDACTABLE[ctx.tool];
  const redactor = ctx.redactor ?? identityRedactor;
  const value = asRecord(state.value, "redact");
  if (!field || redactor === identityRedactor || typeof value[field] !== "string") return state;

  let output: unknown;
  try {
    output = await redactor.redact({
      text: value[field],
      allowedFields: [...ctx.allowedFields],
      guidance: ctx.guidance ?? "",
      privateHints: [...(ctx.privateHints ?? [])],
    });
  } catch (error) {
    if (error instanceof BrokerError) throw error;
    throw new BrokerError("internal", "No se pudo revisar la respuesta antes de entregarla.");
  }

  const text = (output as { text?: unknown } | null)?.text;
  if (typeof text !== "string") throw new BrokerError("internal", "El redactor devolvió un resultado inválido.");
  if (text === value[field]) return state;

  return addFlags({ ...state, value: { ...value, [field]: text } }, [{ stage: "redact", code: "redacted", field }]);
};
