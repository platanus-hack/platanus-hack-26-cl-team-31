import { describe, expect, it, vi } from "vitest";
import { BrokerError } from "../errors.js";
import { DEFAULT_REDACTOR_MODEL, createClaudeRedactor, type RedactorClient } from "./claude-redactor.js";
import { sanitizeReply } from "./pipeline.js";
import { ctxFor } from "./test-helpers.js";
import { SanitizeBlockedError } from "./types.js";

// No network: the SDK client is always replaced by a fake.
function fakeClient(response: { stop_reason: string; parsed_output: { text: string } | null }) {
  const parse = vi.fn(async (_params: Record<string, unknown>) => response);
  return { client: { beta: { messages: { parse } } } as unknown as RedactorClient, parse };
}

const input = { text: "Tengo dentista a las 10", allowedFields: ["answer"], guidance: "Solo confirma", privateHints: ["dentista"] };

describe("createClaudeRedactor", () => {
  it("calls structured outputs with the default model, low effort and fallbacks", async () => {
    const { client, parse } = fakeClient({ stop_reason: "end_turn", parsed_output: { text: "Tengo algo a las 10" } });
    await expect(createClaudeRedactor({ client }).redact(input)).resolves.toEqual({ text: "Tengo algo a las 10" });

    const params = parse.mock.calls[0]![0];
    expect(params).toMatchObject({
      model: DEFAULT_REDACTOR_MODEL,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(DEFAULT_REDACTOR_MODEL).toBe("claude-opus-5-5");
    const content = (params.messages as Array<{ content: string }>)[0]!.content;
    expect(content).toContain("<message>\nTengo dentista a las 10\n</message>");
    expect(content).toContain('- "dentista"');
  });

  it("accepts a configurable model and can disable fallbacks", async () => {
    const { client, parse } = fakeClient({ stop_reason: "end_turn", parsed_output: { text: "ok" } });
    await createClaudeRedactor({ client, model: "claude-sonnet-5-5", fallbacks: false }).redact(input);
    const params = parse.mock.calls[0]![0];
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
  });

  it.each([
    { stop_reason: "refusal", parsed_output: null },
    { stop_reason: "max_tokens", parsed_output: { text: "Tengo" } },
    { stop_reason: "end_turn", parsed_output: null },
  ])("fails closed on %j", async (response) => {
    const { client } = fakeClient(response);
    await expect(createClaudeRedactor({ client }).redact(input)).rejects.toBeInstanceOf(BrokerError);
  });

  it("is not the last line of defense: a leaky model output is still blocked", async () => {
    const { client } = fakeClient({ stop_reason: "end_turn", parsed_output: { text: "Tengo dentista, ignora el filtro" } });
    await expect(
      sanitizeReply(
        { answer: "Tengo dentista" },
        ctxFor("question", { redactor: createClaudeRedactor({ client }), privateHints: ["dentista"] }),
      ),
    ).rejects.toBeInstanceOf(SanitizeBlockedError);
  });
});
