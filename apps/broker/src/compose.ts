import { createPrivateKey } from "node:crypto";
import { createBroker, createMemoryStore } from "@team-31/broker";
import { createPostgresStore } from "@team-31/broker/postgres";
import { createWaker } from "@team-31/wake";
import type { BrokerEnv } from "./env.js";
import type { BrokerServiceTelemetry } from "./telemetry.js";

function openStore(env: BrokerEnv) {
  if (!env.DATABASE_URL) {
    console.warn("[broker] DATABASE_URL ausente. Se usa un store en memoria y los datos se pierden al reiniciar.");
    return { store: createMemoryStore(), close: () => Promise.resolve() };
  }
  if (!env.WAKE_SECRETS_KEY) throw new Error("Se requiere WAKE_SECRETS_KEY con DATABASE_URL.");
  const store = createPostgresStore({ databaseUrl: env.DATABASE_URL, secretsKey: env.WAKE_SECRETS_KEY });
  return { store, close: () => store.close() };
}

export function composeBroker(env: BrokerEnv, telemetry?: Pick<BrokerServiceTelemetry, "shared">) {
  const signingKey = createPrivateKey({ key: env.BROKER_SIGNING_KEY, format: "jwk" });
  const waker = createWaker({ allowInsecure: env.WAKE_ALLOW_INSECURE, telemetry: telemetry?.shared });
  const { store, close } = openStore(env);
  const broker = createBroker({
    store,
    waker,
    clock: { now: () => new Date() },
    signingKey,
    nonceKey: env.NONCE_KEY,
    config: {
      requestTtlSeconds: env.REQUEST_TTL_SECONDS,
      // The initial job is due immediately. The core indexes retries by one-based attempt.
      wakeRetryDelaysMs: [0, ...env.WAKE_RETRY_DELAYS_MS],
      addressDomain: "nexo.app",
    },
    ...(telemetry ? { telemetry: telemetry.shared } : {}),
  });
  return { broker, close };
}
