import { randomUUID } from "node:crypto";
import { Address, TagChange, TagIds, TagInput, TagUpdate, type Principal, type Tag, type TagsView } from "@team-31/protocol";
import { sameSharing } from "@team-31/protocol/constants";
import { BrokerError, notFound } from "../errors.js";
import type { BrokerDeps, OwnerPort } from "../ports.js";
import type { StoreTx } from "../store/store.js";
import type { RecordEvent } from "./events.js";

type By = "owner" | "agent";
type TagPort = Pick<OwnerPort, "tags" | "createTag" | "updateTag" | "deleteTag" | "setContactTags">;

export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function createTags(
  { store }: Pick<BrokerDeps, "store">,
  record: RecordEvent,
  denyUnauthorizedInboxRequests: (tx: StoreTx, userId: string) => Promise<void>,
) {
  async function knownTags(tx: StoreTx, userId: string, ids: readonly string[]): Promise<Tag[]> {
    const tags = await tx.listTags(userId);
    if (ids.some((id) => !tags.some((tag) => tag.id === id))) throw notFound();
    return tags;
  }

  async function view(tx: StoreTx, userId: string): Promise<TagsView> {
    const tags = await tx.listTags(userId);
    const contacts = await tx.listContactAddresses(userId);
    const byContact = await tx.listContactTags(userId);
    return {
      tags: tags.map((tag) => ({
        ...tag, members: contacts.filter((address) => byContact.get(address)?.includes(tag.id)),
      })),
    };
  }

  // A tag opens its categories at once, so changing who carries it may close pending requests.
  async function tagContact(tx: StoreTx, userId: string, address: Address, ids: readonly string[], by: By) {
    await knownTags(tx, userId, ids);
    if (!await tx.setContactTags(userId, address, ids)) throw notFound();
    await denyUnauthorizedInboxRequests(tx, userId);
    record(tx, "broker.contact.tagged", { userId, attrs: { tags: ids.length, by } });
  }

  async function create(tx: StoreTx, userId: string, input: TagInput, by: By): Promise<Tag> {
    if (!(await tx.getUser(userId))?.address) throw new BrokerError("invalid_input", "Primero elige tu dirección Sideband.");
    await tx.listTags(userId);
    const tag: Tag = { id: randomUUID(), name: input.name, color: input.color ?? "slate", categories: input.categories ?? [] };
    await tx.putTag(userId, tag);
    record(tx, "broker.tag.changed", { userId, attrs: { action: "created", by, categories: tag.categories.length } });
    return tag;
  }

  async function update(tx: StoreTx, userId: string, tagId: string, input: TagUpdate, by: By): Promise<Tag> {
    const current = (await tx.listTags(userId)).find((tag) => tag.id === tagId);
    if (!current) throw notFound();
    const tag: Tag = {
      id: tagId, name: input.name ?? current.name, color: input.color ?? current.color, categories: input.categories ?? current.categories,
    };
    await tx.putTag(userId, tag);
    if (!sameSharing(current.categories, tag.categories)) await denyUnauthorizedInboxRequests(tx, userId);
    record(tx, "broker.tag.changed", { userId, attrs: { action: "updated", by, categories: tag.categories.length } });
    return tag;
  }

  async function remove(tx: StoreTx, userId: string, tagId: string, by: By): Promise<void> {
    if (!await tx.deleteTag(userId, tagId)) throw notFound();
    await denyUnauthorizedInboxRequests(tx, userId);
    record(tx, "broker.tag.changed", { userId, attrs: { action: "deleted", by } });
  }

  const port: TagPort = {
    tags: (o) => store.tx((tx) => view(tx, o.userId)),
    async createTag(o, input) {
      const parsed = TagInput.safeParse(input);
      if (!parsed.success) throw new BrokerError("invalid_input", "Revisa el nombre y el color de la etiqueta.");
      return store.tx((tx) => create(tx, o.userId, parsed.data, "owner"));
    },
    async updateTag(o, tagId, input) {
      const parsed = TagUpdate.safeParse(input);
      if (!parsed.success) throw new BrokerError("invalid_input", "Revisa los datos de la etiqueta.");
      return store.tx((tx) => update(tx, o.userId, tagId, parsed.data, "owner"));
    },
    async deleteTag(o, tagId) {
      await store.tx((tx) => remove(tx, o.userId, tagId, "owner"));
    },
    async setContactTags(o, contact, ids) {
      const address = Address.safeParse(contact);
      const parsed = TagIds.safeParse(ids);
      if (!address.success || !parsed.success) throw new BrokerError("invalid_input", "Las etiquetas no son válidas.");
      await store.tx(async (tx) => {
        if (!(await tx.listContactAddresses(o.userId)).includes(address.data)) throw notFound();
        await tagContact(tx, o.userId, address.data, parsed.data, "owner");
      });
    },
  };

  async function changeByAgent(tx: StoreTx, p: Principal, input: unknown): Promise<{ tagId: string }> {
    const parsed = TagChange.safeParse(input);
    if (!parsed.success) throw new BrokerError("invalid_input", "Revisa la etiqueta y el contacto.");
    const change = parsed.data;
    switch (change.action) {
      case "create": return { tagId: (await create(tx, p.userId, { name: change.name, color: change.color }, "agent")).id };
      case "update": return { tagId: (await update(tx, p.userId, change.tagId, { name: change.name, color: change.color }, "agent")).id };
      case "delete":
        await remove(tx, p.userId, change.tagId, "agent");
        return { tagId: change.tagId };
      default: {
        if (!(await tx.listContactAddresses(p.userId)).includes(change.address)) throw notFound();
        const current = (await tx.listContactTags(p.userId)).get(change.address) ?? [];
        const next = change.action === "add_contact"
          ? [...new Set([...current, change.tagId])] : current.filter((id) => id !== change.tagId);
        await knownTags(tx, p.userId, [change.tagId]);
        if (!sameTags(current, next)) await tagContact(tx, p.userId, change.address, next, "agent");
        return { tagId: change.tagId };
      }
    }
  }

  return { port, view, changeByAgent, knownTags, tagContact };
}
