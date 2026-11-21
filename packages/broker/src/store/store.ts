import type {
  ActivityEvent,
  Address,
  FinalOutcome,
  RequestStatus,
  PublicAgent,
  ToolName,
  ToolResult,
  WakeResult,
  WakeTarget,
} from "@team-31/protocol";

export type UserRow = {
  userId: string;
  address?: Address;
  displayName?: string;
  createdAt: Date;
};

export type RequestRow = {
  id: string;
  fromAddress: Address;
  toAddress: Address;
  fromUserId: string | null;
  toUserId: string | null;
  targetAgentId?: string;
  tool: ToolName;
  args: unknown;
  purpose?: string;
  status: RequestStatus;
  outcome?: FinalOutcome;
  allowedFields: string[];
  approvedOnce?: boolean;
  guidance: string;
  rule: string;
  decisionReason?: string;
  internalReason?: string;
  result?: ToolResult;
  droppedFields?: string[];
  answeredByAgentId?: string;
  escalated: boolean;
  envelopeSignature: string;
  responseSignature?: string;
  createdAt: Date;
  expiresAt: Date;
  closedAt?: Date;
  version: number;
};

export type RequestEvent = {
  requestId: string;
  at: Date;
  kind: ActivityEvent["kind"];
  status?: RequestStatus;
  // Private audit code. Only kind, at and status go into public activity.
  code?: string;
};

export type WakeJob = {
  id: string;
  requestId: string;
  requestVersion: number;
  attempt: number;
  // Next eligible time. A running job becomes eligible again when its lease expires.
  runAt: Date;
  state: "queued" | "running" | "done";
  lastResult?: WakeResult;
};

export type WakeClaim = WakeJob & { state: "running"; recovered: boolean };

export type AgentConnectionRow = {
  userId: string;
  agentId: string;
  label: string;
  wakeTarget: WakeTarget;
  verifiedAt?: Date;
  lastWakeAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
};

// A live grant: the grantor lets the grantee use the tool and receive these result fields.
export type GrantRow = {
  id: string;
  grantorUserId: string;
  granteeAddress: Address;
  tool: ToolName;
  fields: string[];
  createdAt: Date;
};

export type CircleRow = { id: string; ownerUserId: string; name: string; createdAt: Date };

// An invitation until the invited address joins.
export type CircleMemberRow = { circleId: string; address: Address; joinedAt?: Date };

export interface Store {
  // A rejected callback rolls back all its writes. Keep external I/O outside it.
  tx<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>;
}

export interface StoreTx {
  getUser(userId: string): Promise<UserRow | null>;
  getUserByAddress(address: Address): Promise<UserRow | null>;
  // Creates a user if needed and fails with conflict if either address is occupied.
  createAddress(userId: string, address: Address): Promise<void>;

  // Creates the address-less grantor if needed. A grantor keeps one live grant per grantee and
  // tool: a second put replaces its fields and returns the stored row.
  putGrant(row: GrantRow): Promise<GrantRow>;
  // The three readers below ignore revoked grants.
  listGrants(grantorUserId: string): Promise<GrantRow[]>;
  getGrant(grantorUserId: string, granteeAddress: Address, tool: ToolName): Promise<GrantRow | null>;
  // False when the grantor has no live grant with that id.
  revokeGrant(id: string, grantorUserId: string, at: Date): Promise<boolean>;

  listFriends(userId: string): Promise<Address[]>;
  // True when this transaction creates a new membership.
  addFriend(userId: string, address: Address): Promise<boolean>;
  removeFriend(userId: string, address: Address): Promise<boolean>;
  // An existing live grant takes precedence over the friendship default.
  insertFriendGrant(row: GrantRow): Promise<boolean>;
  revokeFriendGrants(userId: string, address: Address, at: Date): Promise<string[]>;
  // Pending connect requests sent or received by the user, oldest first.
  listOpenInvitations(userId: string): Promise<RequestRow[]>;

  insertCircle(row: CircleRow): Promise<void>;
  getCircle(id: string): Promise<CircleRow | null>;
  // Also deletes its members and invitations.
  deleteCircle(id: string): Promise<void>;
  // Circles the address has joined or is invited to, oldest first.
  listCircles(address: Address): Promise<CircleRow[]>;
  listCircleMembers(circleId: string): Promise<CircleMemberRow[]>;
  // Keeps an existing row, so inviting a member or inviting twice changes nothing.
  inviteCircleMember(circleId: string, address: Address): Promise<void>;
  // False when the address has no pending invitation.
  joinCircle(circleId: string, address: Address, at: Date): Promise<boolean>;
  removeCircleMember(circleId: string, address: Address): Promise<boolean>;
  // True when both addresses have joined the same circle.
  shareCircle(a: Address, b: Address): Promise<boolean>;

  insertRequest(row: RequestRow): Promise<void>;
  getRequest(
    id: string,
    participant?: { fromUserId: string } | { toUserId: string },
    forUpdate?: boolean,
  ): Promise<RequestRow | null>;
  // Increments version on success. The patch cannot replace id or version.
  updateRequest(id: string, patch: Partial<Omit<RequestRow, "id" | "version">>, expectedVersion: number): Promise<boolean>;
  listInbox(toAddress: Address): Promise<RequestRow[]>;
  listOwnerPending(toAddress: Address): Promise<RequestRow[]>;
  listActivity(address: Address, limit: number): Promise<RequestRow[]>;
  listDueForExpiry(now: Date, limit: number): Promise<RequestRow[]>;
  appendEvent(event: RequestEvent): Promise<void>;
  // Returns events in insertion order for the supplied, already authorized request IDs.
  listEvents(requestIds: readonly string[]): Promise<RequestEvent[]>;

  enqueueWake(job: WakeJob): Promise<void>;
  // Reclaiming an expired lease advances the attempt and invalidates the previous worker.
  claimDueWakes(now: Date, leaseUntil: Date, limit: number): Promise<WakeClaim[]>;
  // Commits only for the current, unexpired lease. A retry advances the attempt.
  recordWakeAttempt(claim: WakeClaim, now: Date, result: WakeResult, nextRunAt: Date | null): Promise<boolean>;
  // Locks the current job so an operator and a worker cannot reschedule it concurrently.
  getWakeForUpdate(requestId: string, requestVersion: number): Promise<WakeJob | null>;
  expediteQueuedWake(jobId: string, now: Date): Promise<void>;

  // Creates the user if needed, inserts only if missing, and locks the returned row
  // until the transaction ends. Preserves the wake configuration and revocation.
  ensureAgentConnection(row: AgentConnectionRow): Promise<AgentConnectionRow>;
  upsertAgentConnection(row: AgentConnectionRow): Promise<void>;
  // Oldest first, then by agent ID in UTF-8 byte order.
  listPublicAgents(): Promise<PublicAgent[]>;
  listAgentConnections(userId: string): Promise<AgentConnectionRow[]>;
  getAgentConnection(userId: string, agentId: string, forUpdate?: boolean): Promise<AgentConnectionRow | null>;
}
