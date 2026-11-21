import type { KeyObject, webcrypto } from "node:crypto";
import type { Waker } from "@team-31/protocol";
import type { AdminPort, AgentPort, OwnerPort } from "@team-31/broker-client";
import type { BrokerTelemetry } from "./core/events.js";
import type { SanitizeContext } from "./sanitize/types.js";
import type { Store } from "./store/store.js";

export type { AdminPort, AgentPort, OwnerPort } from "@team-31/broker-client";
export type { AdminActor } from "@team-31/protocol";

export type TickReport = {
  expired: number;
  wakesOk: number;
  wakesRetried: number;
  wakesFailed: number;
};

export type BrokerCore = {
  agent: AgentPort;
  owner: OwnerPort;
  admin: AdminPort;
  tick(now: Date): Promise<TickReport>;
};

export type { Store } from "./store/store.js";

export type BrokerDeps = {
  documentStorage?: DocumentStorage;
  store: Store;
  waker: Waker;
  clock: { now(): Date };
  signingKey: webcrypto.CryptoKey | KeyObject;
  nonceKey: Uint8Array;
  config: { requestTtlSeconds: number; wakeRetryDelaysMs: number[]; addressDomain: string };
  // Lifecycle, policy and permission events (docs/admin.md#3). Optional so the core stays decoupled.
  telemetry?: BrokerTelemetry;
  // Every agent reply passes through sanitizeReply before it is stored or delivered. These options only
  // tune it (e.g. an LLM redactor for free text); the deterministic stages always run.
  sanitize?: Pick<SanitizeContext, "redactor" | "canaries" | "contacts" | "limits">;
};

export interface DocumentStorage {
  uploadUrl(key: string, sizeBytes: number): Promise<string>;
  verifyAndStore(key: string, sizeBytes: number, sha256: string): Promise<void>;
  cacheLegacy(key: string, bytes: Buffer): Promise<void>;
  downloadUrl(key: string, legacy: boolean): Promise<string>;
}
export type { BrokerTelemetry } from "./core/events.js";

export type CreateBroker = (deps: BrokerDeps) => BrokerCore;
