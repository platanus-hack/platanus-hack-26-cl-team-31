import { describe, expect, it } from "vitest";
import { BrokerError } from "../errors.js";
import { parse } from "./parse.js";
import { ctxFor, stateOf } from "./test-helpers.js";
import type { SanitizeContext } from "./types.js";

function run(value: unknown, ctx: SanitizeContext = ctxFor("question")) {
  return parse(stateOf(value), ctx);
}

function expectInvalid(value: unknown, message: RegExp | string, ctx: SanitizeContext = ctxFor("question")) {
  const call = () => parse(stateOf(value), ctx);
  expect(call).toThrow(BrokerError);
  expect(call).toThrow(expect.objectContaining({ code: "invalid_input" }));
  expect(call).toThrow(message);
}

describe("parse", () => {
  it("accepts a valid reply and returns a fresh object", () => {
    const raw = { answer: "Sí" };
    const out = run(raw);
    expect(out.value).toEqual({ answer: "Sí" });
    expect(out.value).not.toBe(raw);
    expect(out.flags).toEqual([]);
  });

  it("drops and reports unknown keys by default", () => {
    const out = run({ answer: "Sí", internalReason: "privado", note: 1 });
    expect(out.value).toEqual({ answer: "Sí" });
    expect(out.dropped).toEqual(["internalReason", "note"]);
    expect(out.flags.map((flag) => flag.code)).toEqual(["unknown_field_dropped", "unknown_field_dropped"]);
  });

  it("rejects unknown keys in strict mode", () => {
    expectInvalid({ answer: "Sí", extra: true }, /campos no permitidos.*extra/, ctxFor("question", { unknownKeys: "reject" }));
  });

  it.each([
    ["null", null, "debe ser un objeto"],
    ["string", "Sí", "debe ser un objeto"],
    ["number", 42, "debe ser un objeto"],
    ["array", [{ answer: "Sí" }], "debe ser un objeto"],
    ["Date", new Date(), "objeto simple"],
    ["Map", new Map([["answer", "Sí"]]), "objeto simple"],
    ["class instance", new (class Reply { answer = "Sí"; })(), "objeto simple"],
  ])("rejects a non-plain value: %s", (_label, value, message) => {
    expectInvalid(value, message);
  });

  it.each([
    ["wrong type", { answer: 1 }, "revisa answer"],
    ["nested object", { answer: { text: "Sí" } }, "revisa answer"],
    ["array instead of string", { answer: ["Sí"] }, "revisa answer"],
    ["empty string", { answer: "" }, "revisa answer"],
    ["missing field", {}, "revisa answer"],
  ])("rejects wrong shapes: %s", (_label, value, message) => {
    expectInvalid(value, message);
  });

  it("rejects prototype-pollution keys from JSON input", () => {
    expectInvalid(JSON.parse('{"answer":"Sí","__proto__":{"admin":true}}'), "__proto__");
    expectInvalid({ answer: "Sí", constructor: { prototype: {} } }, "constructor");
    expectInvalid({ answer: "Sí", prototype: 1 }, "prototype");
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it("accepts null-prototype objects", () => {
    const raw = Object.assign(Object.create(null) as object, { answer: "Sí" });
    expect(run(raw).value).toEqual({ answer: "Sí" });
  });

  it("rejects accessors so a getter cannot change the value between reads", () => {
    let reads = 0;
    const raw = {
      get answer() {
        reads += 1;
        return reads === 1 ? "ok" : "secreto";
      },
    };
    expectInvalid(raw, "campo calculado");
  });

  it("reads proxies exactly once", () => {
    const raw = new Proxy({ answer: "Sí" }, {});
    expect(run(raw).value).toEqual({ answer: "Sí" });
  });

  it("drops non-enumerable known fields", () => {
    const raw = { answer: "Sí" };
    Object.defineProperty(raw, "answer", { value: "oculto", enumerable: false });
    expectInvalid(raw, "revisa answer");
  });

  it("ignores symbol keys", () => {
    expect(run({ answer: "Sí", [Symbol("x")]: "secreto" }).value).toEqual({ answer: "Sí" });
  });

  it("enforces payload limits", () => {
    expectInvalid({ answer: "x".repeat(9000) }, "largo máximo");
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
    expectInvalid({ answer: "Sí", ...many }, "máximo de 32 campos");
    expectInvalid({ answer: "Sí", ["k".repeat(65)]: 1 }, "nombre de campo demasiado largo");
    expectInvalid(
      { available: true, freeSlots: Array.from({ length: 201 }, () => "09:00-10:00") },
      "máximo de 200 elementos",
      ctxFor("availability"),
    );
    expectInvalid({ available: true, freeSlots: ["x".repeat(9000)] }, "largo máximo", ctxFor("availability"));
  });

  it("rejects sparse arrays and array accessors", () => {
    // eslint-disable-next-line no-sparse-arrays
    expectInvalid({ available: true, freeSlots: ["09:00-10:00", , "11:00-12:00"] }, "freeSlots.1", ctxFor("availability"));
    const slots = ["09:00-10:00"];
    Object.defineProperty(slots, 0, { get: () => "09:00-10:00" });
    expectInvalid({ available: true, freeSlots: slots }, "freeSlots.0", ctxFor("availability"));
  });

  it("validates each tool's schema", () => {
    expect(run({ displayName: "Ana" }, ctxFor("profile")).value).toEqual({ displayName: "Ana" });
    expectInvalid({ available: "yes" }, "revisa available", ctxFor("availability"));
    expectInvalid({ available: true, freeSlots: ["9-10"] }, "revisa freeSlots.0", ctxFor("availability"));
  });

  it("rejects an unknown tool", () => {
    expectInvalid({ answer: "Sí" }, "Herramienta desconocida", { tool: "calendar" as never, allowedFields: [] });
  });
});
