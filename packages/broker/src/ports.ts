import type { KeyObject, webcrypto } from "node:crypto";
import type {
  ActivityItem,
  Capability,
  Address,
  AgentConnection,
  AskInput,
  InboxItem,
  Owner,
  OwnerDecision,
  OwnerPendingItem,
  Principal,
  ReplyInput,
  ReplyReceipt,
  RequesterView,
  SharingRules,
  WakeTarget,
  Waker,
} from "@team-31/protocol";
import type { Store } from "./store/store.js";

export interface AgentPort {
  capabilities(p: Principal, to: Address): Promise<{ tools: Capability[] }>;
  ask(p: Principal, input: AskInput): Promise<RequesterView>;
  inbox(p: Principal): Promise<InboxItem[]>;
  reply(p: Principal, input: ReplyInput): Promise<ReplyReceipt>;
  status(p: Principal, requestId: string): Promise<RequesterView>;
  connectWake(p: Principal, target: WakeTarget): Promise<AgentConnection>;
  disconnectWake(p: Principal, subscriptionId: string): Promise<void>;
}

export interface OwnerPort {
  me(o: Owner): Promise<{ userId: string; address?: Address; displayName?: string }>;
  claimAddress(o: Owner, localPart: string): Promise<Address>;
  getRules(o: Owner): Promise<SharingRules>;
  setRules(o: Owner, rules: SharingRules): Promise<void>;
  pending(o: Owner): Promise<OwnerPendingItem[]>;
  activity(o: Owner, limit?: number): Promise<ActivityItem[]>;
  decide(o: Owner, requestId: string, decision: OwnerDecision): Promise<void>;
  agents(o: Owner): Promise<AgentConnection[]>;
  setWake(o: Owner, agentId: string, target: WakeTarget): Promise<void>;
  ping(o: Owner, agentId: string): Promise<{ requestId: string }>;
  revokeAgent(o: Owner, agentId: string): Promise<void>;
}

export type TickReport = {
  expired: number;
  wakesOk: number;
  wakesRetried: number;
  wakesFailed: number;
};

export type BrokerCore = {
  agent: AgentPort;
  owner: OwnerPort;
  tick(now: Date): Promise<TickReport>;
};

export type { Store } from "./store/store.js";

export type BrokerDeps = {
  store: Store;
  waker: Waker;
  clock: { now(): Date };
  signingKey: webcrypto.CryptoKey | KeyObject;
  nonceKey: Uint8Array;
  config: { requestTtlSeconds: number; wakeRetryDelaysMs: number[]; addressDomain: string };
};

export type CreateBroker = (deps: BrokerDeps) => BrokerCore;
