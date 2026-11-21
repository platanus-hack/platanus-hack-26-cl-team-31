import { Address, ContactTag, type OwnerVault, type VaultCatalog } from "@team-31/protocol";
import { and, DrizzleQueryError, eq, exists, inArray, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";
import type { StoreTx } from "../store.js";
import { BrokerError } from "../../errors.js";
import {
  users, friends, contactTags as t, vaultCategories as c, vaultPermissions as p, vaultEntries as e,
  vaultContactGroups as g, vaultContactGroupMembers as m, vaultContactGroupPermissions as gp, vaultMemberRules as r,
} from "./schema.js";

type Tx = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];

// Foreign keys guard concurrent deletion of contacts and groups. Use a savepoint
// so a missing parent returns false without requiring UPDATE rights to lock it.
async function insertWithParents(db: Tx, insert: (tx: Tx) => Promise<unknown>) {
  try {
    await db.transaction(insert);
    return true;
  } catch (error) {
    if (error instanceof DrizzleQueryError && (error.cause as { code?: string })?.code === "23503") return false;
    throw error;
  }
}

export function vaultStore(db: Tx): Pick<StoreTx, "vaultCatalog" | "vaultMembers" | "ownerVault" | "changeVault" | "sharedVault" | "contactGroups" | "changeContactGroup"> {
  // Serialize name resolution (including an absent name) with category creation, rename and deletion.
  const lockNames = (owner: string) => db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner}, 417))`);
  async function vaultCatalog(owner: string, forNameResolution = false): Promise<VaultCatalog> {
    if (forNameResolution) await lockNames(owner);
    const rows = await db.select({ id: c.id, name: c.name }).from(c).where(eq(c.owner, owner)).orderBy(c.name, c.id);
    const categories: VaultCatalog["categories"] = rows.map(row => ({ ...row, groups: [], contactGroups: [] }));
    if (!categories.length) return { categories };
    const byId = new Map(categories.map(category => [category.id, category]));
    const permissions = await db.select({ id: p.id, group: p.group }).from(p).where(eq(p.owner, owner)).orderBy(p.group);
    for (const { id, group } of permissions) byId.get(id)?.groups.push(ContactTag.parse(group));
    const custom = await db.select({ categoryId: gp.id, id: g.id, name: g.name }).from(gp)
      .innerJoin(g, and(eq(g.owner, gp.owner), eq(g.id, gp.groupId))).where(eq(gp.owner, owner)).orderBy(g.name, g.id);
    for (const { categoryId, id, name } of custom) byId.get(categoryId)?.contactGroups.push({ id, name });
    return { categories };
  }

  // Both the roster and the data read apply this predicate to a (category, accepted contact) pair.
  const canRead = sql<boolean>`coalesce(
    (select ${r.allowed} from ${r} where ${r.owner} = ${c.owner} and ${r.id} = ${c.id} and ${r.address} = ${friends.address}),
    exists(select 1 from ${p} join ${t} on ${t.userId} = ${p.owner} and ${t.tag} = ${p.group}
      where ${p.owner} = ${c.owner} and ${p.id} = ${c.id} and ${t.address} = ${friends.address}) or
    exists(select 1 from ${gp} join ${m} on ${m.owner} = ${gp.owner} and ${m.groupId} = ${gp.groupId}
      where ${gp.owner} = ${c.owner} and ${gp.id} = ${c.id} and ${m.address} = ${friends.address}))`;

  function memberRows(owner: string, categoryId?: string) {
    return db.select({ id: c.id, address: friends.address }).from(c)
      .leftJoin(friends, and(eq(friends.userId, c.owner), canRead))
      .where(and(eq(c.owner, owner), categoryId ? eq(c.id, categoryId) : undefined)).orderBy(friends.address);
  }

  return {
    async vaultMembers(owner, categoryId) {
      const rows = await memberRows(owner, categoryId);
      return rows.length ? rows.flatMap(({ address }) => address ? [Address.parse(address)] : []) : null;
    },
    vaultCatalog,
    async ownerVault(owner) {
      const catalog = await vaultCatalog(owner);
      const categories: OwnerVault["categories"] = catalog.categories.map(({ contactGroups, ...category }) => ({
        ...category, ...(contactGroups.length ? { contactGroups } : {}), entries: [], members: [],
      }));
      if (!categories.length) return { categories };

      const byId = new Map(categories.map(category => [category.id, category]));
      for (const { id, address } of await memberRows(owner)) {
        if (address) byId.get(id)?.members?.push(Address.parse(address));
      }
      const entries = await db.select({ id: e.id, label: e.label, value: e.value }).from(e).where(eq(e.owner, owner)).orderBy(e.label);
      for (const { id, label, value } of entries) byId.get(id)?.entries.push({ label, value });
      return { categories };
    },
    async contactGroups(owner) {
      const rows = await db.select({ id: g.id, name: g.name, address: m.address }).from(g)
        .leftJoin(m, and(eq(g.owner, m.owner), eq(g.id, m.groupId))).where(eq(g.owner, owner)).orderBy(g.name, g.id, m.address);
      const groups = new Map<string, { id: string; name: string; members: Address[] }>();
      for (const { id, name, address } of rows) {
        const group = groups.get(id) ?? { id, name, members: [] };
        if (address) group.members.push(Address.parse(address));
        groups.set(id, group);
      }
      return { groups: [...groups.values()] };
    },
    async changeContactGroup(owner, id, change) {
      if (change.action === "create") {
        const inserted = await db.insert(g).values({ owner, id, name: change.name }).onConflictDoNothing().returning({ id: g.id });
        if (!inserted.length) throw new BrokerError("conflict", "Ya tienes un grupo con ese nombre.");
        return true;
      }
      const group = and(eq(g.owner, owner), eq(g.id, id));
      if (change.action === "delete") return !!(await db.delete(g).where(group).returning({ id: g.id })).length;
      if (change.action === "add_contact") {
        return insertWithParents(db, async tx => tx.insert(m).values({ owner, groupId: id, address: change.address }).onConflictDoNothing());
      }
      if (!(await db.select({ id: g.id }).from(g).where(group)).length) return false;
      await db.delete(m).where(and(eq(m.owner, owner), eq(m.groupId, id), eq(m.address, change.address)));
      return true;
    },
    async changeVault(owner, id, change) {
      if (change.action === "create" || change.action === "rename" || change.action === "delete") await lockNames(owner);
      const category = and(eq(c.owner, owner), eq(c.id, id));
      if (change.action === "create") {
        await db.insert(c).values({ owner, id, name: change.name });
        return true;
      }
      if (!(await db.select({ id: c.id }).from(c).where(category).for("update")).length) return false;
      switch (change.action) {
        case "rename": await db.update(c).set({ name: change.name }).where(category); break;
        case "delete": await db.delete(c).where(category); break;
        case "set_member":
          return insertWithParents(db, async tx => tx.insert(r).values({ owner, id, address: change.address, allowed: change.allowed })
            .onConflictDoUpdate({ target: [r.owner, r.id, r.address], set: { allowed: change.allowed } }));
        case "set_group":
          if (change.allowed) await db.insert(p).values({ owner, id, group: change.group }).onConflictDoNothing();
          else await db.delete(p).where(and(eq(p.owner, owner), eq(p.id, id), eq(p.group, change.group)));
          break;
        case "set_contact_group":
          if (change.allowed) {
            return insertWithParents(db, async tx => tx.insert(gp).values({ owner, id, groupId: change.groupId }).onConflictDoNothing());
          }
          if (!(await db.select({ id: g.id }).from(g).where(and(eq(g.owner, owner), eq(g.id, change.groupId)))).length) return false;
          await db.delete(gp).where(and(eq(gp.owner, owner), eq(gp.id, id), eq(gp.groupId, change.groupId)));
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
      if (!id) return { categories: await db.select({ id: c.id, name: c.name }).from(c).where(visible).orderBy(c.name, c.id) };
      const rows = await db.select({ name: c.name, entry: { label: e.label, value: e.value } }).from(c)
        .leftJoin(e, and(eq(e.owner, c.owner), eq(e.id, c.id))).where(and(visible, eq(c.id, id))).orderBy(e.label);
      return { categories: rows[0] ? [{ id, name: rows[0].name, entries: rows.flatMap(row => row.entry ? [row.entry] : []) }] : [] };
    },
  };
}
