import { createHmac, timingSafeEqual } from "node:crypto";

export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const encoded = secret.slice("whsec_".length);
  const key = Buffer.from(encoded, "base64");
  if (!secret.startsWith("whsec_") || !key.length ||
      key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new TypeError("Secreto de webhook inválido");
  }

  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${signature}`;
}

export function verify(secret: string, id: string, timestamp: number, body: string, signature: string): boolean {
  let expected: Buffer;
  try {
    expected = Buffer.from(sign(secret, id, timestamp, body));
  } catch {
    return false;
  }

  return signature.split(/\s+/).some((value) => {
    const candidate = Buffer.from(value);
    return candidate.length === expected.length && timingSafeEqual(expected, candidate);
  });
}

export function signedHeaders(secret: string, id: string, timestamp: number, body: string): Record<string, string> {
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp.toString(),
    "webhook-signature": sign(secret, id, timestamp, body),
  };
}
