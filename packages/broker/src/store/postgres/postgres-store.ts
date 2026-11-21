import {
  ActivityEvent, Address, Category, ChannelName, FinalOutcome, RequestStatus, ToolArgs, ToolName, ToolResultSchemas, WakeKind, WakeResult, type ToolResult,
  ContactTag, Sharing,
} from "@team-31/protocol";
import { and, asc, desc, DrizzleQueryError, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { activeAgentConflict, BrokerError } from "../../errors.js";
import { wakeClaim } from "../store.js";
import type {
  AgentConnectionRow, ChannelRow, GrantRow, RequestEvent, RequestRow, Store, StoreTx, UserRow, WakeJob,
} from "../store.js";
import { createWakeCodec } from "./crypto.js";
import { vaultStore } from "./vault-store.js";
import {
  agentConnections, channels, circleMembers, circles, contactTags, friends, grants, requestEvents, requests, tagPresets, users, wakeJobs,
} from "./schema.js";

export type PostgresStoreOptions = {
  databaseUrl: string;
  /** A 32-byte secret encoded in base64. */
  secretsKey: string;
};

export interface PostgresStore extends Store {
  consumeQuota(userId: string, bucket: string, limit: number): Promise<{ retryAfter: number } | undefined>;
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

function readGrant({ revokedAt: _revokedAt, ...row }: typeof grants.$inferSelect): GrantRow {
  return { ...row, granteeAddress: parseStored(Address, row.granteeAddress), category: parseStored(Category, row.category) };
}

function readRequest(row: typeof requests.$inferSelect): RequestRow {
  const tool = parseStored(ToolName, row.tool);
  return {
    ...row,
    tool,
    fromAddress: parseStored(Address, row.fromAddress),
    toAddress: parseStored(Address, row.toAddress),
    targetAgentId: row.targetAgentId ?? undefined,
    senderGroupId: row.senderGroupId ?? undefined,
    originChannel: row.originChannel === null ? undefined : parseStored(ChannelName, row.originChannel),
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

  // The codec binds each secret to its owner and name. A channel cannot reuse an agent's secret.
  function channelIdentity({ userId, name }: Pick<ChannelRow, "userId" | "name">) {
    return { userId, agentId: `channel:${name}` };
  }

  function readChannel({ wakeKind, wakePublic, wakeSecret, ...row }: typeof channels.$inferSelect): ChannelRow {
    const name = parseStored(ChannelName, row.name);
    return {
      userId: row.userId, name, createdAt: row.createdAt,
      wakeTarget: codec.decode({
        ...channelIdentity({ userId: row.userId, name }), wakeKind: parseStored(WakeKind, wakeKind), wakePublic, wakeSecret,
      }),
    };
  }

  async function getAgentConnection(userId: string, agentId: string, forUpdate = false) {
    const query = db.select().from(agentConnections)
      .where(and(eq(agentConnections.userId, userId), eq(agentConnections.agentId, agentId)));
    const [row] = await (forUpdate ? query.for("update") : query);
    return row ? readConnection(row) : null;
  }

  return {
    ...vaultStore(db),
    async networkAddresses(after, limit, q) {
      const connected = db.select({ id: agentConnections.userId }).from(agentConnections);
      const rows = await db.select({ address: users.address }).from(users)
        .where(and(isNotNull(users.address), inArray(users.userId, connected), after ? gt(users.address, after) : undefined,
          q ? sql`strpos(${users.address}, ${q}) > 0` : undefined))
        .orderBy(users.address).limit(limit);
      return rows.map(row => parseStored(Address, row.address));
    },
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
        target: [grants.grantorUserId, grants.granteeAddress, grants.category],
        targetWhere: sql`revoked_at is null`,
        // Rewrites the same value so the statement returns the live row.
        set: { category: row.category },
      }).returning();
      return readGrant(stored!);
    },

    async listGrants(grantorUserId) {
      const rows = await db.select().from(grants)
        .where(and(eq(grants.grantorUserId, grantorUserId), isNull(grants.revokedAt)))
        .orderBy(asc(grants.createdAt), asc(grants.id));
      return rows.map(readGrant);
    },

    async getGrant(grantorUserId, granteeAddress, category) {
      const [row] = await db.select().from(grants).where(and(
        eq(grants.grantorUserId, grantorUserId), eq(grants.granteeAddress, granteeAddress),
        eq(grants.category, category), isNull(grants.revokedAt),
      ));
      return row ? readGrant(row) : null;
    },

    async revokeGrant(id, grantorUserId, at) {
      const revoked = await db.update(grants).set({ revokedAt: at })
        .where(and(eq(grants.id, id), eq(grants.grantorUserId, grantorUserId), isNull(grants.revokedAt)))
        .returning({ id: grants.id });
      return revoked.length > 0;
    },

    async listContactAddresses(userId) {
      const rows = await db.select({ address: friends.address }).from(friends)
        .where(eq(friends.userId, userId)).orderBy(asc(friends.address));
      return rows.map(({ address }) => parseStored(Address, address));
    },

    async addContact(userId, address) {
      const inserted = await db.insert(friends).values({ userId, address }).onConflictDoNothing()
        .returning({ address: friends.address });
      return inserted.length > 0;
    },

    async removeContact(userId, address) {
      const removed = await db.delete(friends).where(and(eq(friends.userId, userId), eq(friends.address, address)))
        .returning({ address: friends.address });
      return removed.length > 0;
    },

    async listContactTags(userId) {
      const rows = await db.select().from(contactTags).where(eq(contactTags.userId, userId));
      return new Map(rows.map((row) => [parseStored(Address, row.address), parseStored(ContactTag, row.tag)]));
    },

    async setContactTag(userId, address, tag) {
      if (!tag) {
        await db.delete(contactTags).where(and(eq(contactTags.userId, userId), eq(contactTags.address, address)));
        return;
      }
      await ensureUser(userId);
      await db.insert(contactTags).values({ userId, address, tag })
        .onConflictDoUpdate({ target: [contactTags.userId, contactTags.address], set: { tag } });
    },

    async listTagPresets(userId) {
      const rows = await db.select().from(tagPresets).where(eq(tagPresets.userId, userId));
      return Object.fromEntries(rows.map((row) => [parseStored(ContactTag, row.tag), parseStored(Sharing, row.categories)]));
    },

    async putTagPreset(userId, tag, sharing) {
      await ensureUser(userId);
      await db.insert(tagPresets).values({ userId, tag, categories: sharing })
        .onConflictDoUpdate({ target: [tagPresets.userId, tagPresets.tag], set: { categories: sharing } });
    },

    async listOpenInvitations(userId) {
      const rows = await db.select().from(requests).where(and(
        eq(requests.tool, "connect"),
        inArray(requests.status, ["awaiting_agent", "awaiting_owner"]),
        or(eq(requests.fromUserId, userId), eq(requests.toUserId, userId)),
      )).orderBy(asc(requests.createdAt), asc(requests.id));
      return rows.map(readRequest);
    },

    async insertCircle(row) {
      const inserted = await db.insert(circles).values(row).onConflictDoNothing({ target: circles.id }).returning({ id: circles.id });
      if (!inserted.length) throw new BrokerError("conflict", "El círculo ya existe.");
    },

    async getCircle(id) {
      const [row] = await db.select().from(circles).where(eq(circles.id, id));
      return row ?? null;
    },

    async deleteCircle(id) {
      await db.delete(circles).where(eq(circles.id, id));
    },

    async listCircles(address) {
      const rows = await db.select({ circle: circles }).from(circles)
        .innerJoin(circleMembers, eq(circleMembers.circleId, circles.id))
        .where(eq(circleMembers.address, address)).orderBy(asc(circles.createdAt), asc(circles.id));
      return rows.map(({ circle }) => circle);
    },

    async listCircleMembers(circleId) {
      const rows = await db.select().from(circleMembers)
        .where(eq(circleMembers.circleId, circleId)).orderBy(asc(circleMembers.address));
      return rows.map((row) => ({
        circleId: row.circleId, address: parseStored(Address, row.address), ...(row.joinedAt ? { joinedAt: row.joinedAt } : {}),
      }));
    },

    async inviteCircleMember(circleId, address) {
      await db.insert(circleMembers).values({ circleId, address }).onConflictDoNothing();
    },

    async joinCircle(circleId, address, at) {
      const joined = await db.update(circleMembers).set({ joinedAt: at })
        .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.address, address), isNull(circleMembers.joinedAt)))
        .returning({ address: circleMembers.address });
      return joined.length > 0;
    },

    async removeCircleMember(circleId, address) {
      const removed = await db.delete(circleMembers)
        .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.address, address)))
        .returning({ address: circleMembers.address });
      return removed.length > 0;
    },

    async shareCircle(a, b) {
      const other = alias(circleMembers, "other");
      const [shared] = await db.select({ circleId: circleMembers.circleId }).from(circleMembers)
        .innerJoin(other, eq(other.circleId, circleMembers.circleId))
        .where(and(
          eq(circleMembers.address, a), isNotNull(circleMembers.joinedAt),
          eq(other.address, b), isNotNull(other.joinedAt),
        )).limit(1);
      return shared !== undefined;
    },

    async insertRequest(row) {
      const [inserted] = await db.insert(requests).values(row).onConflictDoNothing().returning({ id: requests.id });
      if (!inserted) throw new BrokerError("conflict", "La solicitud ya existe.");
    },

    async getRequest(id, participant, forUpdate) {
      // The worker looks up an already claimed job's request by ID. All ports supply a participant.
      const sender = participant && "fromUserId" in participant ? eq(requests.fromUserId, participant.fromUserId) : undefined;
      const recipient = participant && "toUserId" in participant ? eq(requests.toUserId, participant.toUserId) : undefined;
      const query = db.select().from(requests).where(and(eq(requests.id, id), sender, recipient));
      const [row] = await (forUpdate ? query.for("no key update") : query);
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

    async listActivity(address, limit, requestId) {
      const owner = ownerId(address);
      const participant = or(
        and(eq(requests.fromAddress, address), inArray(requests.fromUserId, owner)),
        and(eq(requests.toAddress, address), inArray(requests.toUserId, owner)),
      );
      const rows = await db.select().from(requests)
        .where(and(participant, requestId === undefined ? undefined : eq(requests.id, requestId)))
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

    async claimDueWakes(now, leaseUntil, limit) {
      const jobs = await db.select().from(wakeJobs)
        .where(and(inArray(wakeJobs.state, ["queued", "running"]), lte(wakeJobs.runAt, now)))
        .orderBy(asc(wakeJobs.runAt), asc(wakeJobs.id)).limit(limit).for("update", { skipLocked: true });
      if (jobs.length > 0) {
        await db.update(wakeJobs).set({
          state: "running", runAt: leaseUntil,
          attempt: sql`case when ${wakeJobs.state} = 'running' then ${wakeJobs.attempt} + 1 else ${wakeJobs.attempt} end`,
        }).where(inArray(wakeJobs.id, jobs.map(({ id }) => id)));
      }
      return jobs.map((job) => {
        const recovered = job.state === "running";
        return wakeClaim({ ...readWake(job), runAt: leaseUntil, attempt: job.attempt + Number(recovered) }, recovered, job.runAt);
      });
    },

    async recordWakeAttempt(claim, now, lastResult, nextRunAt) {
      const [updated] = await db.update(wakeJobs).set(nextRunAt
        ? { lastResult, state: "queued", runAt: nextRunAt, attempt: sql`${wakeJobs.attempt} + 1` }
        : { lastResult, state: "done", runAt: now })
        .where(and(
          eq(wakeJobs.id, claim.id), eq(wakeJobs.state, "running"),
          eq(wakeJobs.attempt, claim.attempt), gt(wakeJobs.runAt, now),
        )).returning({ id: wakeJobs.id });
      return updated !== undefined;
    },

    async getWakeForUpdate(requestId, requestVersion) {
      const [job] = await db.select().from(wakeJobs)
        .where(and(eq(wakeJobs.requestId, requestId), eq(wakeJobs.requestVersion, requestVersion)))
        .limit(1).for("update");
      return job ? readWake(job) : null;
    },

    async expediteQueuedWake(jobId, now) {
      await db.update(wakeJobs).set({ runAt: now }).where(and(
        eq(wakeJobs.id, jobId), eq(wakeJobs.state, "queued"), gt(wakeJobs.runAt, now),
      ));
    },

    async ensureAgentConnection(row, onCreated) {
      await ensureUser(row.userId, row.createdAt);
      const inserted = await db.insert(agentConnections).values(writeConnection(row)).onConflictDoNothing()
        .returning({ agentId: agentConnections.agentId });
      if (inserted.length > 0) onCreated?.();
      const connection = await getAgentConnection(row.userId, row.agentId, true);
      if (!connection) throw activeAgentConflict();
      return connection;
    },

    async upsertAgentConnection(row) {
      await ensureUser(row.userId, row.createdAt);
      const { userId, agentId, ...configuration } = writeConnection(row);
      await db.insert(agentConnections).values({ userId, agentId, ...configuration }).onConflictDoUpdate({
        target: [agentConnections.userId, agentConnections.agentId], set: configuration,
      });
    },

    async listPublicAgents() {
      const rows = await db.select({ agentId: agentConnections.agentId, label: agentConnections.label, address: users.address })
        .from(agentConnections).innerJoin(users, eq(users.userId, agentConnections.userId))
        .where(and(isNull(agentConnections.revokedAt), isNotNull(users.address)))
        .orderBy(asc(agentConnections.label), asc(users.address));
      return rows.map(({ address, ...agent }) => ({ ...agent, address: parseStored(Address, address) }));
    },
    async listAgentConnections(userId) {
      const rows = await db.select().from(agentConnections).where(eq(agentConnections.userId, userId))
        .orderBy(asc(agentConnections.createdAt), sql`${agentConnections.agentId} COLLATE "C"`);
      return rows.map(readConnection);
    },

    getAgentConnection,

    async putChannel({ wakeTarget, ...row }) {
      await ensureUser(row.userId, row.createdAt);
      const configuration = codec.encode(wakeTarget, channelIdentity(row));
      await db.insert(channels).values({ ...row, ...configuration }).onConflictDoUpdate({
        target: [channels.userId, channels.name], set: configuration,
      });
    },

    async getChannel(userId, name) {
      const [row] = await db.select().from(channels).where(and(eq(channels.userId, userId), eq(channels.name, name)));
      return row ? readChannel(row) : null;
    },
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
  let nextQuotaCleanup = 0;
  return {
    async consumeQuota(userId, bucket, limit) {
      if (Date.now() >= nextQuotaCleanup) {
        nextQuotaCleanup = Date.now() + 60_000;
        await pool.query(`DELETE FROM sideband.quota_windows WHERE (user_id, bucket) IN
          (SELECT user_id, bucket FROM sideband.quota_windows WHERE reset_at <= now()
           ORDER BY reset_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`);
      }
      // Both replicas serialize on the same key. Use the DB clock for the whole window.
      const { rows: [row] } = await pool.query<{ retry: number }>(`
        INSERT INTO sideband.quota_windows AS w (user_id, bucket, count, reset_at)
        VALUES ($1, $2, 1, statement_timestamp() + interval '1 minute')
        ON CONFLICT (user_id, bucket) DO UPDATE SET
          count = CASE WHEN w.reset_at <= statement_timestamp() THEN 1 ELSE least(w.count + 1, $3::int + 1) END,
          reset_at = CASE WHEN w.reset_at <= statement_timestamp() THEN excluded.reset_at ELSE w.reset_at END
        RETURNING CASE WHEN count > $3::int THEN greatest(1, ceil(extract(epoch FROM reset_at - statement_timestamp()))::int)
                       ELSE 0 END AS retry`, [userId, bucket, limit]);
      if (!row) throw new BrokerError("internal", "No se pudo verificar la cuota.");
      return row.retry ? { retryAfter: row.retry } : undefined;
    },
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
