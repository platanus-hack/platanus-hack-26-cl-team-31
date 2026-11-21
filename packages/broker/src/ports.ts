import type { KeyObject, webcrypto } from "node:crypto";
import type {
  ActivityItem,
  AdminActor,
  Capability,
  Grant,
  GrantInput,
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
  WakeTarget,
  Waker,
} from "@team-31/protocol";
import type { BrokerTelemetry } from "./core/events.js";
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
  grants(o: Owner): Promise<Grant[]>;
  // Replaces the fields of the owner's live grant for the same grantee and tool.
  setGrant(o: Owner, input: GrantInput): Promise<Grant>;
  revokeGrant(o: Owner, grantId: string): Promise<void>;
  pending(o: Owner): Promise<OwnerPendingItem[]>;
  activity(o: Owner, limit?: number): Promise<ActivityItem[]>;
  ask(o: Owner, input: AskInput): Promise<RequesterView>;
  status(o: Owner, requestId: string): Promise<RequesterView>;
  decide(o: Owner, requestId: string, decision: OwnerDecision): Promise<void>;
  agents(o: Owner): Promise<AgentConnection[]>;
  setWake(o: Owner, agentId: string, target: WakeTarget): Promise<void>;
  ping(o: Owner, agentId: string): Promise<{ requestId: string }>;
  revokeAgent(o: Owner, agentId: string): Promise<void>;
  connect(o: Owner, to: Address): Promise<RequesterView>;
  friends(o: Owner): Promise<Address[]>;
  removeFriend(o: Owner, friend: Address): Promise<void>;
}

// Operational mutations for apps/admin. The broker keeps the invariant that each request ends in
// exactly one final state, so the admin never writes nexo.* directly. `reason` is 10 to 500 chars.
export interface AdminPort {
  // Only for an `awaiting_agent` request that has not expired. Queues the next wake attempt.
  rewake(a: AdminActor, requestId: string, reason: string): Promise<void>;
  // Closes a pending request as `expired` through the same path as the expiry sweep.
  expire(a: AdminActor, requestId: string, reason: string): Promise<void>;
  // Same as OwnerPort.revokeAgent, for any user.
  revokeAgent(a: AdminActor, userId: string, agentId: string, reason: string): Promise<void>;
}

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
  store: Store;
  waker: Waker;
  clock: { now(): Date };
  signingKey: webcrypto.CryptoKey | KeyObject;
  nonceKey: Uint8Array;
  config: { requestTtlSeconds: number; wakeRetryDelaysMs: number[]; addressDomain: string };
  // Lifecycle, policy and permission events (docs/admin.md#3). Optional so the core stays decoupled.
  telemetry?: BrokerTelemetry;
};

export type { BrokerTelemetry } from "./core/events.js";

export type CreateBroker = (deps: BrokerDeps) => BrokerCore;
