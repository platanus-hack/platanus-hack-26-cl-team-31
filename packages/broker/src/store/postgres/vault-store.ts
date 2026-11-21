import { Address, defaultVaultCategories, type OwnerVault, type VaultCatalog, type VaultDocumentQuery } from "@team-31/protocol";
import { and, DrizzleQueryError, eq, exists, inArray, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";
import { BrokerError } from "../../errors.js";
import type { StoreTx } from "../store.js";
import {
  users, friends, contactTags as t, vaultCategories as c, vaultPermissions as p, vaultEntries as e, vaultDocuments as d, vaultMemberRules as r,
} from "./schema.js";

type Tx = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];

// Foreign keys guard concurrent deletion of contacts and tags. Use a savepoint
// so a missing parent returns false without requiring UPDATE rights to lock it.
export async function insertWithParents(db: Tx, insert: (tx: Tx) => Promise<unknown>) {
  try {
    await db.transaction(insert);
    return true;
  } catch (error) {
    if (error instanceof DrizzleQueryError && (error.cause as { code?: string })?.code === "23503") return false;
    throw error;
  }
}

// An empty description is stored as "" and left out of the answer.
function categoryInfo<T extends { description: string }>({ description, ...category }: T) {
  return { ...category, ...(description ? { description } : {}) };
}

export function vaultStore(db: Tx): Pick<StoreTx, "vaultCatalog" | "vaultMembers" | "ownerVault" | "changeVault" | "sharedVault" | "putVaultDocument" | "sharedVaultDocument"> {
  // Serialize name resolution (including an absent name) with category creation, rename and deletion.
  const lockNames = (owner: string) => db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner}, 417))`);
  // The flag keeps a default category the holder deleted from coming back.
  async function seedDefaults(owner: string) {
    const [first] = await db.update(users).set({ vaultSeeded: true })
      .where(and(eq(users.userId, owner), eq(users.vaultSeeded, false))).returning({ userId: users.userId });
    if (first) await db.insert(c).values(defaultVaultCategories.map(category => ({ owner, ...category }))).onConflictDoNothing();
  }
  async function vaultCatalog(owner: string, forNameResolution = false): Promise<VaultCatalog> {
    if (forNameResolution) await lockNames(owner);
    await seedDefaults(owner);
    const rows = await db.select({ id: c.id, name: c.name, description: c.description }).from(c).where(eq(c.owner, owner)).orderBy(c.name, c.id);
    const categories: VaultCatalog["categories"] = rows.map(row => ({ ...categoryInfo(row), tags: [] }));
    if (!categories.length) return { categories };
    const byId = new Map(categories.map(category => [category.id, category]));
    const permissions = await db.select({ id: p.id, tagId: p.tagId }).from(p).where(eq(p.owner, owner)).orderBy(sql`${p.tagId} collate "C"`);
    for (const { id, tagId } of permissions) byId.get(id)?.tags.push(tagId);
    return { categories };
  }

  // Both the roster and the data read apply this predicate to a (category, accepted contact) pair.
  const canRead = sql<boolean>`coalesce(
    (select ${r.allowed} from ${r} where ${r.owner} = ${c.owner} and ${r.id} = ${c.id} and ${r.address} = ${friends.address}),
    exists(select 1 from ${p} join ${t} on ${t.userId} = ${p.owner} and ${t.tagId} = ${p.tagId}
      where ${p.owner} = ${c.owner} and ${p.id} = ${c.id} and ${t.address} = ${friends.address}))`;

  function memberRows(owner: string, categoryId?: string) {
    return db.select({ id: c.id, address: friends.address }).from(c)
      .leftJoin(friends, and(eq(friends.userId, c.owner), canRead))
      .where(and(eq(c.owner, owner), categoryId ? eq(c.id, categoryId) : undefined)).orderBy(friends.address);
  }

  return {
    async vaultMembers(owner, categoryId) {
      await seedDefaults(owner);
      const rows = await memberRows(owner, categoryId);
      return rows.length ? rows.flatMap(({ address }) => address ? [Address.parse(address)] : []) : null;
    },
    vaultCatalog,
    async ownerVault(owner) {
      const catalog = await vaultCatalog(owner);
      const categories: OwnerVault["categories"] = catalog.categories.map(category => ({ ...category, entries: [], members: [] }));
      if (!categories.length) return { categories };

      const byId = new Map(categories.map(category => [category.id, category]));
      for (const { id, address } of await memberRows(owner)) {
        if (address) byId.get(id)?.members?.push(Address.parse(address));
      }
      const entries = await db.select({ id: e.id, label: e.label, value: e.value }).from(e).where(eq(e.owner, owner)).orderBy(e.label);
      for (const { id, label, value } of entries) byId.get(id)?.entries.push({ label, value });
      return { categories };
    },
    async changeVault(owner, id, change) {
      if (change.action === "create" || change.action === "rename" || change.action === "delete") await lockNames(owner);
      await seedDefaults(owner);
      const category = and(eq(c.owner, owner), eq(c.id, id));
      if (change.action === "create") {
        await db.insert(c).values({ owner, id, name: change.name });
        return true;
      }
      if (!(await db.select({ id: c.id }).from(c).where(category).for("update")).length) return false;
      switch (change.action) {
        case "rename": await db.update(c).set({ name: change.name }).where(category); break;
        case "describe": await db.update(c).set({ description: change.description }).where(category); break;
        case "delete": await db.delete(c).where(category); break;
        case "set_member":
          return insertWithParents(db, async tx => tx.insert(r).values({ owner, id, address: change.address, allowed: change.allowed })
            .onConflictDoUpdate({ target: [r.owner, r.id, r.address], set: { allowed: change.allowed } }));
        case "set_tag":
          if (change.allowed) {
            return insertWithParents(db, async tx => tx.insert(p).values({ owner, id, tagId: change.tagId }).onConflictDoNothing());
          }
          await db.delete(p).where(and(eq(p.owner, owner), eq(p.id, id), eq(p.tagId, change.tagId)));
          break;
        case "put_entry":
          await db.insert(e).values({ owner, id, label: change.label, value: change.value })
            .onConflictDoUpdate({ target: [e.owner, e.id, e.label], set: { value: change.value } });
          break;
        case "delete_entry":
          await db.delete(e).where(and(eq(e.owner, owner), eq(e.id, id), eq(e.label, change.label)));
          break;
      }
      return true;
    },
    async sharedVault(reader, to, id) {
      // Authorization is part of the same SELECT that reads entries. A tag from an outgoing
      // invitation is insufficient: the reader must also be an accepted contact.
      const owner = db.select({ owner: users.userId }).from(users).where(eq(users.address, to));
      const visible = and(inArray(c.owner, owner), exists(db.select({ address: friends.address }).from(friends)
        .where(and(eq(friends.userId, c.owner), eq(friends.address, reader), canRead))));
      const info = { id: c.id, name: c.name, description: c.description };
      if (!id) return { categories: (await db.select(info).from(c).where(visible).orderBy(c.name, c.id)).map(categoryInfo) };
      const rows = await db.select({ ...info, entry: { label: e.label, value: e.value } }).from(c)
        .leftJoin(e, and(eq(e.owner, c.owner), eq(e.id, c.id))).where(and(visible, eq(c.id, id))).orderBy(e.label);
      if (!rows[0]) return { categories: [] };
      const documents = await db.select({
        id: d.id, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, sha256: d.sha256, createdAt: d.createdAt,
      }).from(d).innerJoin(c, and(eq(c.owner, d.owner), eq(c.id, d.categoryId)))
        .where(and(visible, eq(d.categoryId, id)))
        .orderBy(d.createdAt, d.id);
      const { entry: _, ...category } = rows[0];
      return {
        categories: [{
          ...categoryInfo(category),
          entries: rows.flatMap(row => row.entry ? [row.entry] : []),
          ...(documents.length ? {
            documents: documents.map(document => ({
              id: document.id,
              fileName: document.fileName,
              ...(document.mimeType ? { mimeType: document.mimeType } : {}),
              sizeBytes: document.sizeBytes,
              sha256: document.sha256,
              createdAt: document.createdAt.toISOString(),
            })),
          } : {}),
        }],
      };
    },
    async putVaultDocument(row) {
      await seedDefaults(row.owner);
      if (!(await db.select({ id: c.id }).from(c).where(and(eq(c.owner, row.owner), eq(c.id, row.categoryId)))).length) return null;
      await db.insert(d).values({
        ...row,
        mimeType: row.mimeType ?? null,
      }).onConflictDoNothing({ target: [d.owner, d.idempotencyKey] });
      const [stored] = await db.select().from(d)
        .where(and(eq(d.owner, row.owner), eq(d.idempotencyKey, row.idempotencyKey))).for("update");
      if (!stored) return null;
      if (stored.categoryId !== row.categoryId || stored.fileName !== row.fileName ||
          stored.mimeType !== (row.mimeType ?? null) || stored.sha256 !== row.sha256 || stored.sizeBytes !== row.sizeBytes ||
          !Buffer.from(stored.content).equals(Buffer.from(row.content))) {
        throw new BrokerError("conflict", "La clave de idempotencia ya fue usada para otro archivo.");
      }
      return { ...stored, mimeType: stored.mimeType ?? undefined };
    },
    async sharedVaultDocument(reader, to, query: VaultDocumentQuery) {
      const owner = db.select({ owner: users.userId }).from(users).where(eq(users.address, to));
      const allowed = reader === to
        ? sql<boolean>`true`
        : exists(db.select({ address: friends.address }).from(friends)
          .where(and(eq(friends.userId, c.owner), eq(friends.address, reader), canRead)));
      const [document] = await db.select({
        id: d.id, owner: d.owner, categoryId: d.categoryId, fileName: d.fileName, mimeType: d.mimeType,
        sizeBytes: d.sizeBytes, sha256: d.sha256, content: d.content, idempotencyKey: d.idempotencyKey, createdAt: d.createdAt,
      }).from(d).innerJoin(c, and(eq(c.owner, d.owner), eq(c.id, d.categoryId))).where(and(
        eq(d.id, query.documentId), eq(d.categoryId, query.categoryId), inArray(c.owner, owner), allowed,
      ));
      return document ? { ...document, mimeType: document.mimeType ?? undefined } : null;
    },
  };
}
