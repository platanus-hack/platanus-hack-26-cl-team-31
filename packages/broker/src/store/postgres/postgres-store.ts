import {
  ActivityEvent, Address, Category, FinalOutcome, RequestStatus, ToolArgs, ToolName, ToolResultSchemas, WakeKind, WakeResult, type ToolResult,
  TagColor,
} from "@team-31/protocol";
import { and, asc, desc, DrizzleQueryError, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { activeAgentConflict, BrokerError, notFound } from "../../errors.js";
import { wakeClaim } from "../store.js";
import type {
  AgentConnectionRow, GrantRow, RequestEvent, RequestRow, Store, StoreTx, UserRow, WakeJob,
} from "../store.js";
import { directoryCircles, directoryContact, normalizeSearch, publicProfileLimit, sortTags } from "../directory.js";
import { createWakeCodec } from "./crypto.js";
import { contactAccess, insertWithParents, openToTag, seedHolder, vaultStore } from "./vault-store.js";
import {
  agentConnections, askReceipts, circleMembers, circles, contactTags, friends, grants, requestEvents, requests, tags, users, vaultDocuments, vaultPermissions, wakeJobs,
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

function readRequest({ originChannel: _retiredChannel, ...row }: typeof requests.$inferSelect): RequestRow {
  const tool = parseStored(ToolName, row.tool);
  return {
    ...row,
    tool,
    fromAddress: parseStored(Address, row.fromAddress),
    toAddress: parseStored(Address, row.toAddress),
    targetAgentId: row.targetAgentId ?? undefined,
    originAgentId: row.originAgentId ?? undefined,
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
      verifiedAt: row.verifiedAt ?? null, lastWakeAt: row.lastWakeAt ?? null,
      revokedAt: row.revokedAt ?? null, revokedBy: row.revokedBy ?? null,
    };
  }

  function readConnection({ wakeKind, wakePublic, wakeSecret, ...row }: typeof agentConnections.$inferSelect): AgentConnectionRow {
    return {
      ...row,
      wakeTarget: codec.decode({ ...row, wakeKind: parseStored(WakeKind, wakeKind), wakePublic, wakeSecret }),
      verifiedAt: row.verifiedAt ?? undefined,
      lastWakeAt: row.lastWakeAt ?? undefined,
      revokedAt: row.revokedAt ?? undefined,
      revokedBy: row.revokedBy ?? undefined,
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
    async searchPublicProfiles(query) {
      const term = normalizeSearch(query);
      const address = Address.safeParse(term);
      // Address lookups use the unique index. Other queries match literal substrings and
      // rank name or handle matches first, even when the result limit is reached.
      const name = sql`lower(regexp_replace(normalize(coalesce(${users.displayName}, ''), NFD), ${"[\u0300-\u036f]"}, '', 'g'))`;
      const handle = sql`split_part(${users.address}, '@', 1)`;
      const rows = address.success
        ? await db.select({ address: users.address, displayName: users.displayName }).from(users).where(eq(users.address, address.data))
        : await db.select({ address: users.address, displayName: users.displayName }).from(users)
          .where(and(isNotNull(users.address), or(sql`strpos(${users.address}, ${term}) > 0`, sql`strpos(${name}, ${term}) > 0`)))
          .orderBy(sql`case when ${handle} = ${term} or ${name} = ${term} then 0
                            when starts_with(${handle}, ${term}) or starts_with(${name}, ${term}) then 1 else 2 end`,
            sql`${users.address} collate "C"`).limit(publicProfileLimit);
      return rows.map(row => {
        const address = parseStored(Address, row.address);
        return { address, displayName: row.displayName || address.split("@")[0]! };
      });
    },
    async networkAddresses({ after, q }, limit) {
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

    async listContacts(userId) {
      const { rows } = await db.execute<{
        address: string; name: string | null; tags: string[];
      }>(sql`
        SELECT f.address, other.display_name AS name,
          ARRAY(SELECT t.tag_id FROM sideband.contact_tags t WHERE (t.user_id, t.address) = (f.user_id, f.address)) AS tags
        FROM sideband.friends f
        JOIN sideband.users me ON me.user_id = f.user_id AND me.address IS NOT NULL
        LEFT JOIN sideband.users other ON other.address = f.address
        WHERE f.user_id = ${userId}
        ORDER BY f.address COLLATE "C"`);
      if (!rows.length) return [];
      const access = await contactAccess(db, userId);
      return rows.map(row => directoryContact({ ...row, ...access(row.address) }));
    },

    async listJoinedCircles(userId) {
      const { rows } = await db.execute<{
        id: string; circleName: string; address: string | null; memberName: string | null;
      }>(sql`
        SELECT c.id, c.name AS "circleName", m.address, u.display_name AS "memberName"
        FROM sideband.users me
        JOIN sideband.circle_members mine ON mine.address = me.address AND mine.joined_at IS NOT NULL
        JOIN sideband.circles c ON c.id = mine.circle_id
        LEFT JOIN sideband.circle_members m ON m.circle_id = c.id AND m.joined_at IS NOT NULL AND m.address <> me.address
        LEFT JOIN sideband.users u ON u.address = m.address
        WHERE me.user_id = ${userId}
        ORDER BY c.created_at, c.id, m.address COLLATE "C"`);
      return directoryCircles(rows);
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

    async listTags(userId) {
      await ensureUser(userId);
      await seedHolder(db, userId);
      const rows = await db.select().from(tags).where(eq(tags.userId, userId));
      // The categories of a tag are the default vault categories it opens.
      const open = await db.select().from(vaultPermissions).where(eq(vaultPermissions.owner, userId));
      return sortTags(rows.map((row) => ({
        id: row.id, name: row.name, color: parseStored(TagColor, row.color),
        categories: Category.options.filter((id) => open.some((permission) => permission.tagId === row.id && permission.id === id)),
      })));
    },

    async putTag(userId, tag) {
      try {
        await db.transaction((savepoint) => savepoint.insert(tags).values({ userId, ...tag })
          .onConflictDoUpdate({ target: [tags.userId, tags.id], set: { name: tag.name, color: tag.color, categories: tag.categories } }));
      } catch (error) {
        if (error instanceof DrizzleQueryError && (error.cause as { code?: string })?.code === "23505") {
          throw new BrokerError("conflict", "Ya tienes una etiqueta con ese nombre.");
        }
        throw error;
      }
      await seedHolder(db, userId);
      await db.delete(vaultPermissions).where(and(eq(vaultPermissions.owner, userId), eq(vaultPermissions.tagId, tag.id),
        inArray(vaultPermissions.id, Category.options.filter((id) => !tag.categories.includes(id)))));
      await openToTag(db, userId, tag.categories.map((id) => ({ id, tagId: tag.id })));
    },

    async deleteTag(userId, tagId) {
      const removed = await db.delete(tags).where(and(eq(tags.userId, userId), eq(tags.id, tagId))).returning({ id: tags.id });
      return removed.length > 0;
    },

    async listContactTags(userId) {
      const rows = await db.select().from(contactTags).where(eq(contactTags.userId, userId))
        .orderBy(sql`${contactTags.tagId} collate "C"`);
      const byAddress = new Map<Address, string[]>();
      for (const row of rows) {
        const address = parseStored(Address, row.address);
        byAddress.set(address, [...byAddress.get(address) ?? [], row.tagId]);
      }
      return byAddress;
    },

    async setContactTags(userId, address, tagIds) {
      await db.delete(contactTags).where(and(eq(contactTags.userId, userId), eq(contactTags.address, address)));
      if (!tagIds.length) return true;
      return insertWithParents(db, async (tx) => tx.insert(contactTags)
        .values([...new Set(tagIds)].map((tagId) => ({ userId, address, tagId }))).onConflictDoNothing());
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

    async lockRequiredRelation(userId, from, to, relation) {
      if (relation.kind === "circle") {
        const members = await db.select({ address: circleMembers.address }).from(circleMembers).where(and(
          eq(circleMembers.circleId, relation.circleId), inArray(circleMembers.address, [from, to]),
          isNotNull(circleMembers.joinedAt),
        )).orderBy(asc(circleMembers.address)).for("share");
        return members.length === 2;
      }
      const filter = and(eq(friends.userId, userId), eq(friends.address, to));
      const [contact] = await db.select({ address: friends.address }).from(friends).where(filter).for("share");
      if (!contact || !relation.tag) return Boolean(contact);
      const [tag] = await db.select({ tag: contactTags.tagId }).from(contactTags).where(and(
        eq(contactTags.userId, userId), eq(contactTags.address, to), eq(contactTags.tagId, relation.tag),
      )).for("share");
      return Boolean(tag);
    },

    async lockAskReceipt(keyHash) {
      // Separate statements give the waiter a fresh READ COMMITTED snapshot after acquiring the lock.
      await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"ask:" + keyHash}, 0))`);
      const [receipt] = await db.select().from(askReceipts).where(eq(askReceipts.keyHash, keyHash));
      return receipt ?? null;
    },

    async insertAskReceipt(receipt) { await db.insert(askReceipts).values(receipt); },

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

    async reviveAgentConnection(row) {
      // La revocación del admin no se deshace presentando un token: el agente ve el mismo not_found
      // de cualquier recurso ajeno y nunca sabe que lo cortó un operador.
      if (row.revokedBy === "admin") throw notFound();
      const revived: AgentConnectionRow = {
        ...row, revokedAt: undefined, revokedBy: undefined, verifiedAt: undefined, wakeTarget: { kind: "none" },
      };
      const [live] = await db.select({ agentId: agentConnections.agentId }).from(agentConnections).where(and(
        eq(agentConnections.userId, row.userId), ne(agentConnections.agentId, row.agentId), isNull(agentConnections.revokedAt),
      )).limit(1);
      if (live) throw activeAgentConflict();
      const { userId, agentId, ...configuration } = writeConnection(revived);
      try {
        await db.update(agentConnections).set(configuration)
          .where(and(eq(agentConnections.userId, userId), eq(agentConnections.agentId, agentId)));
      } catch (error) {
        // Otro agente pudo conectarse entre la consulta y este UPDATE: el índice parcial
        // agent_connections_one_active tiene la última palabra sobre quién queda vivo.
        if (error instanceof DrizzleQueryError && (error.cause as { code?: string })?.code === "23505") throw activeAgentConflict();
        throw error;
      }
      return revived;
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
      // Replicas serialize on the same key. Report the remaining time after any row-lock wait.
      const { rows: [row] } = await pool.query<{ retry: number }>(`
        INSERT INTO sideband.quota_windows AS w (user_id, bucket, count, reset_at)
        VALUES ($1, $2, 1, statement_timestamp() + interval '1 minute')
        ON CONFLICT (user_id, bucket) DO UPDATE SET
          count = CASE WHEN w.reset_at <= statement_timestamp() THEN 1 ELSE least(w.count + 1, $3::int + 1) END,
          reset_at = CASE WHEN w.reset_at <= statement_timestamp() THEN excluded.reset_at ELSE w.reset_at END
        RETURNING CASE WHEN count > $3::int THEN greatest(1, ceil(extract(epoch FROM reset_at - clock_timestamp()))::int)
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
