import { afterEach, expect, it, vi } from "vitest";
import { getCurrentRunTree } from "langsmith/traceable";
import { createClaudeInterpreter } from "./anthropic.js";

afterEach(() => vi.unstubAllEnvs());

it("usa el contrato estructurado real de LangChain y Anthropic y repara una salida inválida", async () => {
  const inputs: Record<string, unknown>[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    expect(getCurrentRunTree(true)?.tracingEnabled).toBe(false);
    inputs.push(JSON.parse(String(init?.body)));
    const intent = inputs.length === 1 ? { action: "missing" } : { action: "contacts" };
    return Response.json({
      id: "msg_test", model: "claude-haiku-5-5", type: "message", role: "assistant", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "call1", name: "interpret_sideband_message", input: { intent } }],
      usage: { input_tokens: 20, output_tokens: 10 },
    });
  });
  const parse = createClaudeInterpreter({ apiKey: "synthetic-key", fetch });
  expect(await parse("¿Qué contactos tengo?", { at: "2026-11-21T15:00:00Z" })).toEqual({ action: "contacts" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(inputs[0]).toMatchObject({ model: "claude-haiku-5-5", tools: [{ name: "interpret_sideband_message" }] });
  for (const key of ["temperature", "top_p", "top_k"]) expect(inputs[0]).not.toHaveProperty(key);
});


it("evita que el modo verboso de LangChain escriba texto privado en consola", async () => {
  vi.stubEnv("LANGCHAIN_VERBOSE", "true");
  const fetch = vi.fn<typeof globalThis.fetch>();
  const parse = createClaudeInterpreter({ apiKey: "synthetic-key", fetch });
  await expect(parse("texto privado", { at: "2026-11-21T15:00:00Z" })).rejects.toThrow("LANGCHAIN_VERBOSE");
  expect(fetch).not.toHaveBeenCalled();
});
