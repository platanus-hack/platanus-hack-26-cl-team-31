import { ContactTag, type OwnerVault } from "@team-31/protocol";
import { and, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";
import type { StoreTx } from "../store.js";
import { users, friends, contactTags as t, vaultCategories as c, vaultPermissions as p, vaultEntries as e } from "./schema.js";

type Tx = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];
export function vaultStore(db: Tx): Pick<StoreTx, "vaultCatalog" | "ownerVault" | "changeVault" | "sharedVault"> {
  function listCategories(owner: string) {
    return db.select({ id: c.id, name: c.name }).from(c).where(eq(c.owner, owner)).orderBy(c.name, c.id);
  }

  return {
    async vaultCatalog(owner) {
      return { categories: await listCategories(owner) };
    },
    async ownerVault(owner) {
      const categories: OwnerVault["categories"] = (await listCategories(owner)).map(category => ({
        ...category, groups: [], entries: [],
      }));
      if (!categories.length) return { categories };

      const byId = new Map(categories.map(category => [category.id, category]));
      const entries = await db.select({ id: e.id, label: e.label, value: e.value }).from(e).where(eq(e.owner, owner)).orderBy(e.label);
      for (const { id, label, value } of entries) byId.get(id)?.entries.push({ label, value });
      const permissions = await db.select({ id: p.id, group: p.group }).from(p).where(eq(p.owner, owner)).orderBy(p.group);
      for (const { id, group } of permissions) byId.get(id)?.groups.push(ContactTag.parse(group));
      return { categories };
    },
    async changeVault(owner, id, change) {
      const category = and(eq(c.owner, owner), eq(c.id, id));
      if (change.action === "create") {
        await db.insert(c).values({ owner, id, name: change.name });
        return true;
      }
      if (!(await db.select({ id: c.id }).from(c).where(category).for("update")).length) return false;
      switch (change.action) {
        case "rename": await db.update(c).set({ name: change.name }).where(category); break;
        case "delete": await db.delete(c).where(category); break;
        case "set_group":
          if (change.allowed) await db.insert(p).values({ owner, id, group: change.group }).onConflictDoNothing();
          else await db.delete(p).where(and(eq(p.owner, owner), eq(p.id, id), eq(p.group, change.group)));
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
      const allowed = db.select({ id: p.id }).from(p)
        .innerJoin(t, and(eq(t.userId, p.owner), eq(t.tag, p.group), eq(t.address, reader)))
        .innerJoin(friends, and(eq(friends.userId, t.userId), eq(friends.address, t.address)))
        .where(inArray(p.owner, owner));
      const visible = and(inArray(c.owner, owner), inArray(c.id, allowed));
      if (!id) return { categories: await db.select({ id: c.id, name: c.name }).from(c).where(visible).orderBy(c.name, c.id) };
      const rows = await db.select({ name: c.name, entry: { label: e.label, value: e.value } }).from(c)
        .leftJoin(e, and(eq(e.owner, c.owner), eq(e.id, c.id))).where(and(visible, eq(c.id, id))).orderBy(e.label);
      return { categories: rows[0] ? [{ id, name: rows[0].name, entries: rows.flatMap(row => row.entry ? [row.entry] : []) }] : [] };
    },
  };
}
