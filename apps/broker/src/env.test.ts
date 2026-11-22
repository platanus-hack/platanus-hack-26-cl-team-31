import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readEnv } from "./env.js";

const signing = generateKeyPairSync("ed25519");
const publicKey = signing.publicKey.export({ format: "jwk" });
const publicKeys = { mcp: publicKey, web: publicKey };
const nonce = Buffer.alloc(32, 0xfb);
const base = {
  BROKER_PORT: "4201",
  BROKER_SIGNING_KEY: JSON.stringify(signing.privateKey.export({ format: "jwk" })),
  SERVICE_JWT_PUBLIC_KEYS: JSON.stringify(publicKeys),
  NONCE_KEY: nonce.toString("base64"),
};

describe("readEnv del broker", () => {
  it("prepara el arranque en memoria con los valores predeterminados", () => {
    const env = readEnv({ ...base, DATABASE_URL: "", WAKE_SECRETS_KEY: "" });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.WAKE_SECRETS_KEY).toBeUndefined();
    expect(env).toMatchObject({
      BROKER_HOST: "127.0.0.1", BROKER_PORT: 4201,
      NONCE_KEY: nonce, WAKE_ALLOW_INSECURE: false, REQUEST_TTL_SECONDS: 900,
      WAKE_RETRY_DELAYS_MS: [10_000, 30_000], SERVICE_JWT_PUBLIC_KEYS: publicKeys,
    });
    expect(env.SERVICE_JWT_PUBLIC_KEYS.admin).toBeUndefined();
  });

  it("exige la clave de avisos al usar PostgreSQL y la conserva en base64", () => {
    const postgres = { ...base, DATABASE_URL: "postgresql://localhost/broker_test" };
    for (const key of [undefined, "", Buffer.alloc(31).toString("base64")]) {
      expect(() => readEnv({ ...postgres, WAKE_SECRETS_KEY: key })).toThrow(/WAKE_SECRETS_KEY/);
    }
    const key = Buffer.alloc(32, 1).toString("base64");
    expect(readEnv({ ...postgres, WAKE_SECRETS_KEY: key })).toMatchObject({
      DATABASE_URL: postgres.DATABASE_URL, WAKE_SECRETS_KEY: key,
    });
  });

  it("decodifica el nonce sin padding y rechaza base64 que solo un decodificador permisivo aceptaría", () => {
    expect(readEnv({ ...base, NONCE_KEY: base.NONCE_KEY.slice(0, -1) }).NONCE_KEY).toEqual(nonce);
    expect(() => readEnv({ ...base, NONCE_KEY: base.NONCE_KEY + "!" })).toThrow(/NONCE_KEY/);
  });

  it("permite avisos HTTP en desarrollo y los rechaza en producción", () => {
    const insecure = { ...base, WAKE_ALLOW_INSECURE: "1" };
    expect(readEnv({ ...insecure, NODE_ENV: "development" }).WAKE_ALLOW_INSECURE).toBe(true);
    expect(() => readEnv({ ...insecure, NODE_ENV: "production" })).toThrow(/WAKE_ALLOW_INSECURE/);
    expect(readEnv({ ...base, NODE_ENV: "production" }).WAKE_ALLOW_INSECURE).toBe(false);
  });

  it("conserva el orden de los reintentos y permite un reintento inmediato", () => {
    const env = readEnv({ ...base, REQUEST_TTL_SECONDS: "20", WAKE_RETRY_DELAYS_MS: "0,250" });
    expect(env.WAKE_RETRY_DELAYS_MS).toEqual([0, 250]);
    expect(env.REQUEST_TTL_SECONDS).toBe(20);
  });

  it.each(["0", "0,250,500", "250,2147483648"])("rechaza intervalos inválidos (%s)", (delays) => {
    expect(() => readEnv({ ...base, WAKE_RETRY_DELAYS_MS: delays })).toThrow(/WAKE_RETRY_DELAYS_MS/);
  });

  it("acepta la clave pública opcional del admin", () => {
    const admin = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" });
    const keys = { ...publicKeys, admin };
    expect(readEnv({ ...base, SERVICE_JWT_PUBLIC_KEYS: JSON.stringify(keys) }).SERVICE_JWT_PUBLIC_KEYS).toEqual(keys);
  });

  it("identifica las variables inválidas sin incluir sus valores en el diagnóstico de arranque", () => {
    const marker = "valor-sintetico-para-redaccion";
    const parse = () => readEnv({
      ...base,
      BROKER_SIGNING_KEY: marker,
      SERVICE_JWT_PUBLIC_KEYS: JSON.stringify({ ...publicKeys, admin: { ...publicKey, d: marker } }),
      DATABASE_URL: marker,
    });
    for (const name of ["BROKER_SIGNING_KEY", "SERVICE_JWT_PUBLIC_KEYS", "DATABASE_URL"]) {
      expect(parse).toThrow(name);
    }
    expect(parse).toThrow(expect.objectContaining({ message: expect.not.stringContaining(marker) }));
  });
});
