import {
  ActivityEvent, Address, FinalOutcome, RequestStatus, ToolArgs, ToolName,
  ToolResultSchemas, WakeKind, WakeResult, type ToolResult,
} from "@team-31/protocol";
import { and, asc, desc, DrizzleQueryError, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { BrokerError } from "../../errors.js";
import type {
  AgentConnectionRow, GrantRow, RequestEvent, RequestRow, Store, StoreTx, UserRow, WakeJob,
} from "../store.js";
import { createWakeCodec } from "./crypto.js";
import { agentConnections, friends, grants, requestEvents, requests, users, wakeJobs } from "./schema.js";

export type PostgresStoreOptions = {
  databaseUrl: string;
  /** A 32-byte secret encoded in base64. */
  secretsKey: string;
};

export interface PostgresStore extends Store {
  close(): Promise<void>;
}

type Transaction = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];
type SafeSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

function parseStored<T>(schema: SafeSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BrokerError("internal", "No se pudo leer un registro del broker.");
  return parsed.data;
}

function readUser(row: typeof users.$inferSelect): UserRow {
  return {
    ...row,
    address: row.address === null ? undefined : parseStored(Address, row.address),
    displayName: row.displayName ?? undefined,
  };
}

function readGrant({ revokedAt: _revokedAt, friendDefault: _friendDefault, ...row }: typeof grants.$inferSelect): GrantRow {
  return { ...row, granteeAddress: parseStored(Address, row.granteeAddress), tool: parseStored(ToolName, row.tool) };
}

function readRequest(row: typeof requests.$inferSelect): RequestRow {
  const tool = parseStored(ToolName, row.tool);
  return {
    ...row,
    tool,
    fromAddress: parseStored(Address, row.fromAddress),
    toAddress: parseStored(Address, row.toAddress),
    targetAgentId: row.targetAgentId ?? undefined,
    args: parseStored<unknown>(ToolArgs[tool], row.args),
    purpose: row.purpose ?? undefined,
    status: parseStored(RequestStatus, row.status),
    outcome: row.outcome === null ? undefined : parseStored(FinalOutcome, row.outcome),
    approvedOnce: row.approvedOnce ?? undefined,
    decisionReason: row.decisionReason ?? undefined,
    internalReason: row.internalReason ?? undefined,
    result: row.result === null ? undefined : parseStored<ToolResult>(ToolResultSchemas[tool], row.result),
    droppedFields: row.droppedFields ?? undefined,
    answeredByAgentId: row.answeredByAgentId ?? undefined,
    responseSignature: row.responseSignature ?? undefined,
    closedAt: row.closedAt ?? undefined,
  };
}

function readEvent(row: typeof requestEvents.$inferSelect): RequestEvent {
  const detail = row.detail as Pick<RequestEvent, "status" | "code">;
  return {
    requestId: row.requestId,
    at: row.at,
    kind: parseStored(ActivityEvent.shape.kind, row.kind),
    status: parseStored(RequestStatus.optional(), detail?.status),
    code: typeof detail?.code === "string" ? detail.code : undefined,
  };
}

function readWake(row: typeof wakeJobs.$inferSelect): WakeJob {
  return { ...row, lastResult: row.lastResult === null ? undefined : parseStored(WakeResult, row.lastResult) };
}

function transaction(db: Transaction, codec: ReturnType<typeof createWakeCodec>): StoreTx {
  async function ensureUser(userId: string, createdAt?: Date) {
    await db.insert(users).values({ userId, createdAt }).onConflictDoNothing();
  }

  function ownerId(address: Address) {
    return db.select({ id: users.userId }).from(users).where(eq(users.address, address));
  }

  async function listRecipientRequests(address: Address, status: "awaiting_agent" | "awaiting_owner") {
    const rows = await db.select().from(requests)
      .where(and(eq(requests.toAddress, address), inArray(requests.toUserId, ownerId(address)), eq(requests.status, status)))
      .orderBy(asc(requests.createdAt), asc(requests.id));
    return rows.map(readRequest);
  }

  function writeConnection({ wakeTarget, ...row }: AgentConnectionRow) {
    return {
      ...row, ...codec.encode(wakeTarget, row),
      verifiedAt: row.verifiedAt ?? null, lastWakeAt: row.lastWakeAt ?? null, revokedAt: row.revokedAt ?? null,
    };
  }

  function readConnection({ wakeKind, wakePublic, wakeSecret, ...row }: typeof agentConnections.$inferSelect): AgentConnectionRow {
    return {
      ...row,
      wakeTarget: codec.decode({ ...row, wakeKind: parseStored(WakeKind, wakeKind), wakePublic, wakeSecret }),
      verifiedAt: row.verifiedAt ?? undefined,
      lastWakeAt: row.lastWakeAt ?? undefined,
      revokedAt: row.revokedAt ?? undefined,
    };
  }

  async function getAgentConnection(userId: string, agentId: string, forUpdate = false) {
    const query = db.select().from(agentConnections)
      .where(and(eq(agentConnections.userId, userId), eq(agentConnections.agentId, agentId)));
    const [row] = await (forUpdate ? query.for("update") : query);
    return row ? readConnection(row) : null;
  }

  return {
    async getUser(userId) {
      const [row] = await db.select().from(users).where(eq(users.userId, userId));
      return row ? readUser(row) : null;
    },

    async getUserByAddress(address) {
      const [row] = await db.select().from(users).where(eq(users.address, address));
      return row ? readUser(row) : null;
    },

    async createAddress(userId, address) {
      // A savepoint lets the enclosing transaction recover from a conflicting address.
      try {
        const [row] = await db.transaction((savepoint) => savepoint.insert(users).values({ userId, address })
          .onConflictDoUpdate({ target: users.userId, set: { address }, setWhere: sql`${users.address} is null` })
          .returning({ userId: users.userId }));
        if (!row) throw new BrokerError("conflict", "Esa dirección ya está tomada.");
      } catch (error) {
        if (error instanceof DrizzleQueryError && (error.cause as { code?: string })?.code === "23505") {
          throw new BrokerError("conflict", "Esa dirección ya está tomada.");
        }
        throw error;
      }
    },

    async putGrant(row) {
      await ensureUser(row.grantorUserId);
      const [stored] = await db.insert(grants).values(row).onConflictDoUpdate({
        target: [grants.grantorUserId, grants.granteeAddress, grants.tool],
        targetWhere: sql`revoked_at is null`,
        set: { fields: row.fields, friendDefault: false },
      }).returning();
      return readGrant(stored!);
    },

    async listGrants(grantorUserId) {
      const rows = await db.select().from(grants)
        .where(and(eq(grants.grantorUserId, grantorUserId), isNull(grants.revokedAt)))
        .orderBy(asc(grants.createdAt), asc(grants.id));
      return rows.map(readGrant);
    },

    async getGrant(grantorUserId, granteeAddress, tool) {
      const [row] = await db.select().from(grants).where(and(
        eq(grants.grantorUserId, grantorUserId), eq(grants.granteeAddress, granteeAddress),
        eq(grants.tool, tool), isNull(grants.revokedAt),
      ));
      return row ? readGrant(row) : null;
    },

    async revokeGrant(id, grantorUserId, at) {
      const revoked = await db.update(grants).set({ revokedAt: at })
        .where(and(eq(grants.id, id), eq(grants.grantorUserId, grantorUserId), isNull(grants.revokedAt)))
        .returning({ id: grants.id });
      return revoked.length > 0;
    },

    async listFriends(userId) {
      const rows = await db.select({ address: friends.address }).from(friends)
        .where(eq(friends.userId, userId)).orderBy(asc(friends.address));
      return rows.map(({ address }) => parseStored(Address, address));
    },

    async addFriend(userId, address) {
      const inserted = await db.insert(friends).values({ userId, address }).onConflictDoNothing()
        .returning({ address: friends.address });
      return inserted.length > 0;
    },

    async removeFriend(userId, address) {
      const removed = await db.delete(friends).where(and(eq(friends.userId, userId), eq(friends.address, address)))
        .returning({ address: friends.address });
      return removed.length > 0;
    },

    async insertFriendGrant(row) {
      const inserted = await db.insert(grants).values({ ...row, friendDefault: true })
        .onConflictDoNothing({
          target: [grants.grantorUserId, grants.granteeAddress, grants.tool],
          where: sql`revoked_at is null`,
        }).returning({ id: grants.id });
      return inserted.length > 0;
    },

    async revokeFriendGrants(userId, address, at) {
      const revoked = await db.update(grants).set({ revokedAt: at }).where(and(
        eq(grants.grantorUserId, userId), eq(grants.granteeAddress, address),
        eq(grants.friendDefault, true), isNull(grants.revokedAt),
      )).returning({ id: grants.id });
      return revoked.map(({ id }) => id);
    },

    async listOpenInvitations(userId) {
      const rows = await db.select().from(requests).where(and(
        eq(requests.tool, "connect"),
        inArray(requests.status, ["awaiting_agent", "awaiting_owner"]),
        or(eq(requests.fromUserId, userId), eq(requests.toUserId, userId)),
      )).orderBy(asc(requests.createdAt), asc(requests.id));
      return rows.map(readRequest);
    },

    async insertRequest(row) {
      const [inserted] = await db.insert(requests).values(row).onConflictDoNothing().returning({ id: requests.id });
      if (!inserted) throw new BrokerError("conflict", "La solicitud ya existe.");
    },

    async getRequest(id, participant) {
      // The worker looks up an already claimed job's request by ID. All ports supply a participant.
      const sender = participant && "fromUserId" in participant ? eq(requests.fromUserId, participant.fromUserId) : undefined;
      const recipient = participant && "toUserId" in participant ? eq(requests.toUserId, participant.toUserId) : undefined;
      const [row] = await db.select().from(requests).where(and(eq(requests.id, id), sender, recipient));
      return row ? readRequest(row) : null;
    },

    async updateRequest(id, patch, expectedVersion) {
      // An explicit undefined clears an optional field. A missing field leaves it alone.
      const changes = Object.fromEntries(Object.entries(patch).map(([column, value]) => [column, value ?? null]));
      delete changes.id;
      const [updated] = await db.update(requests).set({
        ...changes, version: sql`${requests.version} + 1`,
      }).where(and(eq(requests.id, id), eq(requests.version, expectedVersion)))
        .returning({ id: requests.id });
      return updated !== undefined;
    },

    listInbox: (address) => listRecipientRequests(address, "awaiting_agent"),
    listOwnerPending: (address) => listRecipientRequests(address, "awaiting_owner"),

    async listActivity(address, limit) {
      const owner = ownerId(address);
      const rows = await db.select().from(requests)
        .where(or(
          and(eq(requests.fromAddress, address), inArray(requests.fromUserId, owner)),
          and(eq(requests.toAddress, address), inArray(requests.toUserId, owner)),
        ))
        .orderBy(desc(requests.createdAt), desc(requests.id)).limit(limit);
      return rows.map(readRequest);
    },

    async listDueForExpiry(now, limit) {
      // The expiry worker acts across participants, bounded by pending state, time and batch size.
      const rows = await db.select().from(requests)
        .where(and(inArray(requests.status, ["awaiting_agent", "awaiting_owner"]), lte(requests.expiresAt, now)))
        .orderBy(asc(requests.expiresAt), asc(requests.id)).limit(limit);
      return rows.map(readRequest);
    },

    async appendEvent({ requestId, at, kind, ...detail }) {
      await db.insert(requestEvents).values({ requestId, at, kind, detail });
    },

    async listEvents(requestIds) {
      if (requestIds.length === 0) return [];
      const rows = await db.select().from(requestEvents)
        .where(inArray(requestEvents.requestId, requestIds)).orderBy(asc(requestEvents.id));
      return rows.map(readEvent);
    },

    async enqueueWake(job) {
      const [inserted] = await db.insert(wakeJobs).values(job).onConflictDoNothing().returning({ id: wakeJobs.id });
      if (!inserted) throw new BrokerError("conflict", "El aviso ya existe.");
    },

    async claimDueWakes(now, limit) {
      const jobs = await db.select().from(wakeJobs)
        .where(and(eq(wakeJobs.state, "queued"), lte(wakeJobs.runAt, now)))
        .orderBy(asc(wakeJobs.runAt), asc(wakeJobs.id)).limit(limit).for("update", { skipLocked: true });
      if (jobs.length > 0) {
        await db.update(wakeJobs).set({ state: "running" }).where(inArray(wakeJobs.id, jobs.map(({ id }) => id)));
      }
      return jobs.map((job) => readWake({ ...job, state: "running" }));
    },

    async completeWake(jobId, lastResult, nextRunAt) {
      await db.update(wakeJobs).set(nextRunAt
        ? { lastResult, state: "queued", runAt: nextRunAt, attempt: sql`${wakeJobs.attempt} + 1` }
        : { lastResult, state: "done" })
        .where(and(eq(wakeJobs.id, jobId), eq(wakeJobs.state, "running")));
    },

    async ensureAgentConnection(row) {
      await ensureUser(row.userId, row.createdAt);
      await db.insert(agentConnections).values(writeConnection(row)).onConflictDoNothing();
      const connection = await getAgentConnection(row.userId, row.agentId, true);
      if (!connection) throw new BrokerError("internal", "No se pudo registrar la conexión del agente.");
      return connection;
    },

    async upsertAgentConnection(row) {
      await ensureUser(row.userId, row.createdAt);
      const { userId, agentId, ...configuration } = writeConnection(row);
      await db.insert(agentConnections).values({ userId, agentId, ...configuration }).onConflictDoUpdate({
        target: [agentConnections.userId, agentConnections.agentId], set: configuration,
      });
    },

    async listAgentConnections(userId) {
      const rows = await db.select().from(agentConnections).where(eq(agentConnections.userId, userId))
        .orderBy(asc(agentConnections.createdAt), asc(agentConnections.agentId));
      return rows.map(readConnection);
    },

    getAgentConnection,
  };
}

export function createPostgresStore({ databaseUrl, secretsKey }: PostgresStoreOptions): PostgresStore {
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para el Store de Postgres.");
  const codec = createWakeCodec(secretsKey);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // pg removes failed idle clients. The next checkout can reconnect.
  pool.on("error", () => {});
  const db = drizzle(pool);
  let closed: Promise<void> | undefined;
  return {
    async tx(fn) {
      try {
        return await db.transaction((tx) => fn(transaction(tx, codec)));
      } catch (error) {
        if (error instanceof DrizzleQueryError) {
          // Drizzle errors include SQL parameters, which can contain private request data.
          throw new BrokerError("internal", "No se pudo completar la operación en Postgres.");
        }
        throw error;
      }
    },
    close: () => closed ??= pool.end(),
  };
}
