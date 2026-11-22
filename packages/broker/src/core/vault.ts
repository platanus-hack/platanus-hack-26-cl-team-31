import { createHash, randomUUID } from "node:crypto";
import {
  Category, MAX_VAULT_DOCUMENT_BYTES, ToolArgs, VaultChange, VaultDocumentQuery, VaultDocumentUpload, VaultQuery,
  type Address, type Sharing, type VaultDocumentDownload,
} from "@team-31/protocol";
import { BrokerError, notFound } from "../errors.js";
import type { BrokerDeps } from "../ports.js";
import { documentMetadata, type RequestRow, type StoreTx } from "../store/store.js";
import type { RecordEvent } from "./events.js";
import { knownTags } from "./tags.js";

export function createVault(clock: BrokerDeps["clock"], record: RecordEvent) {
  async function queryVault(tx: StoreTx, userId: string, input: VaultQuery, agentId?: string) {
    const query = VaultQuery.safeParse(input);
    if (!query.success) throw new BrokerError("invalid_input", "Revisa la dirección y la categoría.");
    const reader = (await tx.getUser(userId))?.address;
    const result = reader ? await tx.sharedVault(reader, query.data.to, query.data.categoryId) : { categories: [] };
    record(tx, "broker.vault.queried", { userId, agentId,
      attrs: { lookup: query.data.categoryId ? "entries" : "categories", visible: result.categories.length > 0 } });
    return result;
  }

  async function changeVault(tx: StoreTx, userId: string, input: VaultChange, agentId?: string, requestId?: string) {
    const parsed = VaultChange.safeParse(input);
    if (!parsed.success) throw new BrokerError("invalid_input", "Revisa los datos de la categoría.");
    if (!(await tx.getUser(userId))?.address) throw new BrokerError("invalid_input", "Primero elige tu dirección Sideband.");
    const change = parsed.data;
    const categoryId = change.action === "create" ? randomUUID() : change.categoryId;
    if (change.action === "set_tag") await knownTags(tx, userId, [change.tagId]);
    if (!await tx.changeVault(userId, categoryId, change)) throw notFound();
    record(tx, "broker.vault.changed", { userId, agentId, requestId, attrs: { action: change.action,
      ...(change.action === "set_tag" || change.action === "set_member" ? { allowed: change.allowed } : {}),
      ...(change.action === "set_visibility" || change.action === "create" ? { visibility: change.visibility } : {}) } });
    return { categoryId };
  }

  // What the holder shares with one contact. An individual decision stays only on the default
  // categories where the choice differs from what visibility and tags already say.
  async function shareWith(tx: StoreTx, userId: string, address: Address, sharing: Sharing) {
    const own = (await tx.vaultCatalog(userId)).categories.map((category) => category.id);
    for (const categoryId of Category.options.filter((id) => own.includes(id))) {
      const allowed = sharing.includes(categoryId);
      await changeVault(tx, userId, { action: "clear_member", categoryId, address });
      if (await tx.canReadVault(userId, address, categoryId) !== allowed) {
        await changeVault(tx, userId, { action: "set_member", categoryId, address, allowed });
      }
    }
  }

  async function grantVaultRead(tx: StoreTx, userId: string, row: RequestRow, agentId?: string) {
    const { categoryName } = ToolArgs.vault_access.parse(row.args);
    const { categories } = await tx.vaultCatalog(userId, true);
    const matches = categories.filter(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (matches.length > 1) throw new BrokerError("conflict", "Hay varias categorías con ese nombre. Distingue sus nombres antes de aceptar.");
    const categoryId = matches[0]?.id ?? (await changeVault(tx, userId, { action: "create", name: categoryName }, agentId, row.id)).categoryId;
    await changeVault(tx, userId, { action: "set_member", categoryId, address: row.fromAddress, allowed: true }, agentId, row.id);
  }

  async function grantRequestedCategory(tx: StoreTx, userId: string, row: RequestRow, agentId?: string) {
    const { category } = ToolArgs.category_access.parse(row.args);
    if (!await tx.lockRequiredRelation(userId, row.toAddress, row.fromAddress, { kind: "contact" })) {
      throw new BrokerError("forbidden", "El solicitante ya no es tu contacto.");
    }
    await changeVault(tx, userId, { action: "set_member", categoryId: category, address: row.fromAddress, allowed: true }, agentId, row.id);
  }

  async function uploadVaultDocument(tx: StoreTx, userId: string, input: VaultDocumentUpload, agentId?: string) {
    const parsed = VaultDocumentUpload.safeParse(input);
    if (!parsed.success) throw new BrokerError("invalid_input", "Revisa el archivo y la categoría.");
    if (!(await tx.getUser(userId))?.address) throw new BrokerError("invalid_input", "Primero elige tu dirección Sideband.");
    const content = Buffer.from(parsed.data.contentBase64, "base64");
    if (content.length > MAX_VAULT_DOCUMENT_BYTES) throw new BrokerError("invalid_input", "El archivo supera el límite de 5 MiB.");
    const row = await tx.putVaultDocument({
      id: randomUUID(),
      owner: userId,
      categoryId: parsed.data.categoryId,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      content,
      idempotencyKey: parsed.data.idempotencyKey,
      createdAt: clock.now(),
    });
    if (!row) throw notFound();
    record(tx, "broker.vault.document.uploaded", { userId, agentId, attrs: { sizeBytes: row.sizeBytes } });
    return documentMetadata(row);
  }

  async function downloadVaultDocument(tx: StoreTx, userId: string, input: VaultDocumentQuery, agentId?: string): Promise<VaultDocumentDownload> {
    const parsed = VaultDocumentQuery.safeParse(input);
    if (!parsed.success) throw new BrokerError("invalid_input", "Revisa el documento y la categoría.");
    const reader = (await tx.getUser(userId))?.address;
    if (!reader) throw notFound();
    const row = await tx.sharedVaultDocument(reader, parsed.data.to, parsed.data);
    if (!row) throw notFound();
    const metadata = documentMetadata(row);
    record(tx, "broker.vault.document.downloaded", {
      userId, agentId, attrs: { sizeBytes: row.sizeBytes },
    });
    return { ...metadata, contentBase64: Buffer.from(row.content).toString("base64") };
  }

  return { queryVault, changeVault, shareWith, grantVaultRead, grantRequestedCategory, uploadVaultDocument, downloadVaultDocument };
}
