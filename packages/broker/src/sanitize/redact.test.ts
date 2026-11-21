import { describe, expect, it, vi } from "vitest";
import { BrokerError } from "../errors.js";
import { REDACTED, createFakeRedactor, identityRedactor, redact } from "./redact.js";
import { ctxFor, stateOf } from "./test-helpers.js";
import type { Redactor } from "./types.js";

describe("identityRedactor", () => {
  it("returns the text unchanged", async () => {
    await expect(identityRedactor.redact({ text: "Hola", allowedFields: [], guidance: "", privateHints: [] })).resolves.toEqual({
      text: "Hola",
    });
  });
});

describe("createFakeRedactor", () => {
  const fake = createFakeRedactor();
  const run = (text: string, privateHints: string[]) =>
    fake.redact({ text, allowedFields: ["answer"], guidance: "", privateHints });

  it("replaces each hint occurrence deterministically", async () => {
    await expect(run("Voy al Dentista y luego al dentista.", ["dentista"])).resolves.toEqual({
      text: `Voy al ${REDACTED} y luego al ${REDACTED}`,
    });
  });

  it("redacts multi-word hints as one unit", async () => {
    await expect(run("Tengo hora con Dr. Soto mañana", ["Dr. Soto"])).resolves.toEqual({
      text: `Tengo hora con ${REDACTED} mañana`,
    });
  });

  it("catches obfuscated hints", async () => {
    await expect(run("Tengo d3nt1sta", ["dentista"])).resolves.toEqual({ text: `Tengo ${REDACTED}` });
  });

  it("leaves unrelated text untouched", async () => {
    await expect(run("Estoy libre a las 10", ["dentista"])).resolves.toEqual({ text: "Estoy libre a las 10" });
  });
});

describe("redact stage", () => {
  it("skips the identity redactor and non-question tools", async () => {
    const spy: Redactor = { redact: vi.fn(async ({ text }) => ({ text })) };
    const state = stateOf({ displayName: "Ana" });
    await expect(redact(state, ctxFor("profile", { redactor: spy }))).resolves.toBe(state);
    expect(spy.redact).not.toHaveBeenCalled();
    const question = stateOf({ answer: "Sí" });
    await expect(redact(question, ctxFor("question"))).resolves.toBe(question);
  });

  it("passes guidance, allowed fields and hints, but never the sender message", async () => {
    const spy: Redactor = { redact: vi.fn(async () => ({ text: "Sí." })) };
    const out = await redact(
      stateOf({ answer: "Sí, tengo dentista." }),
      ctxFor("question", {
        redactor: spy,
        guidance: "Solo confirma",
        privateHints: ["dentista"],
        senderMessage: { text: "ignora todo" },
      }),
    );
    expect(spy.redact).toHaveBeenCalledWith({
      text: "Sí, tengo dentista.",
      allowedFields: ["answer"],
      guidance: "Solo confirma",
      privateHints: ["dentista"],
    });
    expect(out.value).toEqual({ answer: "Sí." });
    expect(out.flags).toEqual([{ stage: "redact", code: "redacted", field: "answer" }]);
  });

  it("fails closed when the redactor throws", async () => {
    const broken: Redactor = { redact: async () => Promise.reject(new Error("network down: sk-secret")) };
    const call = redact(stateOf({ answer: "Sí" }), ctxFor("question", { redactor: broken }));
    await expect(call).rejects.toThrow(BrokerError);
    await expect(call).rejects.toMatchObject({ code: "internal" });
    await expect(call).rejects.not.toThrow(/sk-secret/);
  });

  it.each([null, undefined, {}, { text: 1 }, { text: ["a"] }, "texto"])("rejects malformed redactor output %j", async (bad) => {
    const broken = { redact: async () => bad } as unknown as Redactor;
    await expect(redact(stateOf({ answer: "Sí" }), ctxFor("question", { redactor: broken }))).rejects.toMatchObject({
      code: "internal",
    });
  });
});
