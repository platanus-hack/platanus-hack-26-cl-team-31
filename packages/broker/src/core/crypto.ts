import { createHmac, KeyObject, sign, timingSafeEqual, verify, webcrypto } from "node:crypto";

type SigningKey = KeyObject | webcrypto.CryptoKey;

function serialize(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return `[${Array.from(value, (entry) => serialize(entry) ?? "null").join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value).sort().flatMap((key) => {
      const nested = serialize((value as Record<string, unknown>)[key]);
      return nested === undefined ? [] : [`${JSON.stringify(key)}:${nested}`];
    });
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

// Broker envelopes use JSON values with timestamps already converted to ISO strings.
export function canonicalJson(value: unknown): string {
  const json = serialize(value);
  if (json === undefined) throw new TypeError("El valor no se puede firmar como JSON.");
  return json;
}

function requireEd25519(key: SigningKey): void {
  const algorithm = key instanceof KeyObject ? key.asymmetricKeyType : key.algorithm.name.toLowerCase();
  if (algorithm !== "ed25519") throw new TypeError("La firma requiere una llave Ed25519.");
}

export async function signJson(key: SigningKey, value: unknown): Promise<string> {
  requireEd25519(key);
  const bytes = Buffer.from(canonicalJson(value));
  return key instanceof KeyObject
    ? sign(null, bytes, key).toString("base64url")
    : Buffer.from(await webcrypto.subtle.sign("Ed25519", key, bytes)).toString("base64url");
}

export async function verifyJson(key: SigningKey, value: unknown, signature: string): Promise<boolean> {
  requireEd25519(key);
  const bytes = Buffer.from(canonicalJson(value));
  const signed = Buffer.from(signature, "base64url");
  return key instanceof KeyObject
    ? verify(null, bytes, key, signed)
    : webcrypto.subtle.verify("Ed25519", key, signed, bytes);
}

export function deriveNonce(key: Uint8Array, id: string): string {
  return createHmac("sha256", key).update(id).digest("base64url").slice(0, 16);
}

export function hasNonce(key: Uint8Array, id: string, nonce: string): boolean {
  const expected = Buffer.from(deriveNonce(key, id));
  const received = Buffer.from(nonce);
  return received.length === expected.length && timingSafeEqual(expected, received);
}
