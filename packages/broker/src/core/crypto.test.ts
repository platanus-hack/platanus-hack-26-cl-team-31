import { webcrypto } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalJson, deriveNonce, hasNonce, signJson, verifyJson } from "./crypto.js";

it("canonicaliza claves por orden léxico y conserva el orden de los arreglos", () => {
  expect(canonicalJson({ z: [3, { b: false, a: null }], 2: 2, 10: 10, a: undefined }))
    .toBe('{"10":10,"2":2,"z":[3,{"a":null,"b":false}]}');
});

it("firma llaves Web Crypto Ed25519 y verifica el mismo JSON en cualquier orden", async () => {
  const keys = await webcrypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
  if (!("privateKey" in keys)) throw new Error("Se esperaba un par Ed25519.");
  const signature = await signJson(keys.privateKey, { answer: "Sí", requestId: "req-01" });
  expect(await verifyJson(keys.publicKey, { requestId: "req-01", answer: "Sí" }, signature)).toBe(true);
  expect(await verifyJson(keys.publicKey, { requestId: "req-02", answer: "Sí" }, signature)).toBe(false);
});

it("deriva un nonce estable y ligado a una sola solicitud", () => {
  const key = new Uint8Array(32).fill(1);
  const nonce = deriveNonce(key, "req-01");
  expect(nonce).toMatch(/^[a-zA-Z0-9_-]{16}$/);
  expect(hasNonce(key, "req-01", nonce)).toBe(true);
  expect(hasNonce(key, "req-02", nonce)).toBe(false);
  expect(hasNonce(key, "req-01", nonce + "0")).toBe(false);
});
