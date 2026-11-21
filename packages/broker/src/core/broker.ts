import { createHash, randomUUID } from "node:crypto";
import {
  Address,
  ConnectInput,
  systemLocalPart,
  AskInput,
  basicSharing,
  categories,
  Category,
  categoryOf,
  describeTool,
  fieldsOf,
  GrantInput,
  InvitationAnswer,
  Sharing,
  tagSharing,
  ToolArgs,
  VaultChange, VaultQuery,
  ToolResultSchemas,
  ToolName,
  LocalPart, ProfileSearch,
  OwnerDecision,
  ReplyInput,
  WakeTarget,
  agentScopes,
  ChannelName,
  type FinalOutcome,
  type Owner,
  type Principal,
  type ReplyReceipt,
  type RequesterView,
  type ToolResult,
  VaultDocumentQuery,
  VaultDocumentUpload,
  MAX_VAULT_DOCUMENT_BYTES,
  invalidInputMessage,
  type VaultDocumentDownload,
  type VaultDocumentMetadata,
} from "@team-31/protocol";
import { sameSharing } from "@team-31/protocol/constants";
import { BrokerError, notFound } from "../errors.js";
import type { BrokerCore, BrokerDeps } from "../ports.js";
import { sanitizeReply } from "../sanitize/pipeline.js";
import { SanitizeBlockedError, type SanitizeFlag } from "../sanitize/types.js";
import type { RequestRow, StoreTx, VaultDocumentRow } from "../store/store.js";
import { submitOnce } from "./ask-receipt.js";
import { createAdminPort, revokeConnection } from "./admin.js";
import { deriveNonce, hasNonce, signJson } from "./crypto.js";
import { approveOnce, escalate, parseResult, transition } from "./lifecycle.js";
import {
  senderMessage, toActivityItem, toAgentConnection, toGrant, toInboxItem, toOwnerPendingItem, toRequesterView,
} from "./views.js";
import { createLifecycleEvents } from "./events.js";
import { createWorker } from "./worker.js";
import { categoriesOf, createGrantWriter, sharingRule, stillAuthorized } from "./grants.js";
import { createCirclePort } from "./circles.js";
import { createTags, sameTags } from "./tags.js";

const connectionFields = fieldsOf("connect");
const connectionGuidance =
  "Cuéntale a tu titular quién quiere conectar. Sin una orden de aceptar y las categorías que quiere compartir, responde needs_owner.";
// The broker never reads the text of a question, so the recipient's agent keeps it on its category.
const questionGuidance = "Responde solo lo que corresponde a esta categoría. Si la pregunta trata de otra cosa, responde declined.";

function closed(): BrokerError {
  return new BrokerError("conflict", "La solicitud ya no está pendiente para esta acción.");
}

function expired(): BrokerError {
  return new BrokerError("expired", "La solicitud venció.");
}

type Actor = "agent" | "owner" | "broker" | "admin";

// Code of a rejected reply for broker.reply.rejected (never the message).
function rejectionCode(error: BrokerError) {
  if (error instanceof SanitizeBlockedError) return "leak_blocked";
  switch (error.code) {
    case "forbidden": return "nonce";
    case "expired": return "expired";
    case "invalid_input": return "schema";
    case "not_found": return "not_recipient";
    default: return "closed";
  }
}

// Telemetry-safe flag codes (`stage:code`); never the matched text.
function flagCodes(flags: readonly SanitizeFlag[]) {
  return [...new Set(flags.map((flag) => `${flag.stage}:${flag.code}`))].slice(0, 32).join(",");
}

export function createBroker(deps: BrokerDeps): BrokerCore {
  const { clock, config, nonceKey, signingKey, waker, telemetry } = deps;
  const events = createLifecycleEvents(deps.store, deps.telemetry);
  const { store, record } = events;
  const grants = createGrantWriter(clock, record);
  const tags = createTags({ store }, record, grants, (tx, userId) => denyUnauthorizedInboxRequests(tx, userId));
  const systemAddress = Address.parse(`${systemLocalPart}@${config.addressDomain}`);

  function requireScope(principal: Principal, operation: keyof typeof agentScopes): void {
    const scope = agentScopes[operation];
    if (principal.scopes.includes(scope)) return;
    events.emit("auth.scope.denied", {
      userId: principal.userId, agentId: principal.agentId, attrs: { scope, operation: `agent.${operation}` },
    });
    throw new BrokerError("forbidden", "El agente no tiene permiso para esta acción.");
  }

  // One status_changed per persisted transition, plus closed when it reaches a final state.
  // A request written from a channel notifies it when it starts waiting for the recipient's owner
  // and when it closes. Decisions taken while creating it already reached the caller.
  async function recordTransitionAndScheduleOriginWake(tx: StoreTx, before: RequestRow, after: RequestRow, by: Actor): Promise<void> {
    record(tx, "broker.request.status_changed", {
      requestId: before.id, attrs: { from: before.status, to: after.status, by },
    });
    if (after.closedAt) {
      record(tx, "broker.request.closed", {
        requestId: before.id, attrs: { outcome: after.status, escalated: after.escalated },
      });
    }
    if (!after.originChannel || (after.status !== "awaiting_owner" && !after.closedAt)) return;
    // saveTransition stored `after` as the next version.
    await tx.enqueueWake({
      id: randomUUID(), requestId: before.id, requestVersion: before.version + 1, audience: "origin", attempt: 1,
      runAt: clock.now(), state: "queued",
    });
  }

  function deadline(now: Date): Date {
    return new Date(now.getTime() + config.requestTtlSeconds * 1000);
  }

  async function seal(row: RequestRow): Promise<RequestRow> {
    const envelopeSignature = await signJson(signingKey, {
      id: row.id,
      from: row.fromAddress,
      to: row.toAddress,
      tool: row.tool,
      args: row.args,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
    return { ...row, envelopeSignature };
  }

  async function finalize(row: RequestRow, outcome: FinalOutcome, at: Date, result?: ToolResult): Promise<RequestRow> {
    // Use the public denial projection in the signature so verification reveals only the public decision.
    const signedOutcome = outcome === "denied" || outcome === "declined" ? "deny" : outcome;
    return {
      ...row,
      status: outcome,
      outcome,
      result,
      closedAt: at,
      responseSignature: await signJson(signingKey, { requestId: row.id, outcome: signedOutcome, result }),
    };
  }

  async function enqueue(tx: StoreTx, row: RequestRow, now: Date, requestVersion: number, attempt = 1): Promise<void> {
    await tx.enqueueWake({
      id: randomUUID(), requestId: row.id, requestVersion, audience: "recipient", attempt, runAt: now, state: "queued",
    });
  }

  async function saveTransition(tx: StoreTx, row: RequestRow, changed: RequestRow): Promise<boolean> {
    const { id: _id, version: _version, ...patch } = changed;
    return tx.updateRequest(row.id, patch, row.version);
  }

  // The only path that closes a pending request without a reply. `code` marks who closed it, e.g. the admin.
  async function closePending(
    tx: StoreTx, row: RequestRow, outcome: "expired" | "delivery_failed", at: Date, code?: string,
  ): Promise<boolean> {
    const final = await finalize(transition(row, outcome), outcome, at);
    if (!await saveTransition(tx, row, final)) return false;
    await tx.appendEvent({ requestId: row.id, at, kind: "delivery", status: outcome, ...(code ? { code } : {}) });
    await recordTransitionAndScheduleOriginWake(tx, row, final, code?.startsWith("admin_") ? "admin" : "broker");
    return true;
  }

  async function prepareAgentReply(row: RequestRow, reply: ReplyInput, agentId: string, now: Date) {
    const { outcome, internalReason } = reply;
    // The reply only travels after sanitizeReply: strict parse, canonicalization, the grant's field
    // filter, the optional redactor and the deterministic leak-guard. A blocked reply throws
    // SanitizeBlockedError and the request stays awaiting_agent, like a schema error.
    const filtered = outcome === "answered"
      ? await sanitizeReply(reply.result, {
        ...deps.sanitize,
        tool: row.tool,
        allowedFields: row.allowedFields,
        guidance: row.guidance,
        senderMessage: senderMessage(row),
      })
      : null;
    const changed = outcome === "needs_owner"
      ? await seal(escalate(row, deadline(now)))
      : await finalize(transition(row, outcome), outcome, now, filtered?.result);
    const droppedFields = filtered?.dropped ?? [];
    const declaredFields = fieldsOf(row.tool);
    return {
      changed: {
        ...changed, internalReason, answeredByAgentId: agentId,
        droppedFields: droppedFields.filter((field) => declaredFields.includes(field)),
      },
      receipt: {
        requestId: row.id, status: changed.status, deliveredFields: filtered?.delivered ?? [], droppedFields,
      },
      flags: filtered?.flags ?? [],
    };
  }

  async function ensureActiveAgentConnection(tx: StoreTx, principal: Principal) {
    const { userId, agentId } = principal;
    const connection = await tx.ensureAgentConnection({
      userId, agentId, label: agentId, wakeTarget: { kind: "none" }, createdAt: clock.now(),
    }, () => record(tx, "broker.agent.connected", { userId, agentId, attrs: { kind: "none" } }));
    if (connection.revokedAt) throw notFound();
    return connection;
  }

  function offerOf(row: RequestRow): Sharing {
    const parsed = ToolArgs.connect.safeParse(row.args);
    return (parsed.success && parsed.data.share) || basicSharing;
  }

  async function applyConnection(tx: StoreTx, row: RequestRow, recipientShare: Sharing = basicSharing): Promise<void> {
    if (row.tool !== "connect" || row.status !== "answered" || !row.fromUserId || !row.toUserId) return;
    if (!row.result || !("accepted" in row.result) || !row.result.accepted) return;
    const participants = [
      { userId: row.fromUserId, address: row.toAddress, share: offerOf(row) },
      { userId: row.toUserId, address: row.fromAddress, share: recipientShare },
    ];
    // Opposite-direction acceptances acquire the same membership rows in the same order.
    participants.sort((a, b) => a.userId.localeCompare(b.userId));
    for (const { userId, address, share } of participants) {
      if (!await tx.addContact(userId, address)) continue;
      await grants.applySharing(tx, userId, address, share);
    }
    record(tx, "broker.contact.connected", { requestId: row.id, userId: row.toUserId });
  }

  async function closeInvitation(
    tx: StoreTx, row: RequestRow, accept: boolean, share: Sharing | undefined, by: "owner" | "agent",
  ): Promise<void> {
    const now = clock.now();
    const changed = accept
      ? await finalize(transition(row, "answered"), "answered", now, { accepted: true })
      : await finalize(transition(row, "declined"), "declined", now);
    if (!await saveTransition(tx, row, changed)) throw closed();
    await applyConnection(tx, changed, share);
    await recordTransitionAndScheduleOriginWake(tx, row, changed, by);
    await tx.appendEvent({ requestId: row.id, at: now, kind: "permission", status: changed.status });
    await tx.appendEvent({ requestId: row.id, at: now, kind: "delivery", status: changed.status });
  }

  async function submit(
    tx: StoreTx, userId: string, input: AskInput, origin: { agentId?: string; channel?: ChannelName },
  ): Promise<RequesterView | BrokerError> {
    const { agentId, channel } = origin;
    const { to, tool, purpose } = input;
    let args = input.args;
    const from = (await tx.getUser(userId))?.address;
    if (!from) return new BrokerError("invalid_input", "Primero elige tu dirección en la App Sideband.");
    if (from === to) return new BrokerError("invalid_input", "Elige una dirección distinta a la tuya.");
    if (input.requireRelation) {
      const matches = await tx.lockRequiredRelation(userId, from, to, input.requireRelation);
      record(tx, "broker.ask.relation_checked", { userId, agentId, attrs: { kind: input.requireRelation.kind, matches } });
      if (!matches) return notFound();
    }
    const recipient = await tx.getUserByAddress(to);
    let offer = input.tool === "connect" ? input.args.share : undefined;
    const tagIds = input.tool === "connect" ? input.tags : undefined;
    const now = clock.now();
    let crossedInvitationAccepted = false;
    if (recipient && tool === "connect") {
      let ownTags;
      try {
        ownTags = await tags.knownTags(tx, userId, tagIds ?? []);
      } catch (error) {
        if (error instanceof BrokerError) return error;
        throw error;
      }
      if ((await tx.listContactAddresses(userId)).includes(to)) return new BrokerError("invalid_input", "Ya son contactos.");
      const open = (await tx.listOpenInvitations(userId)).filter((row) => row.expiresAt > now);
      const sent = open.find((row) => row.fromUserId === userId && row.toAddress === to);
      if (sent) {
        const previous = (await tx.listContactTags(userId)).get(to) ?? [];
        if ((tagIds !== undefined && !sameTags(previous, tagIds)) || (!agentId && offer !== undefined && !sameSharing(offerOf(sent), offer))) {
          return new BrokerError("conflict", "Ya hay una invitación pendiente con otra configuración.");
        }
        return toRequesterView(sent);
      }
      if (tagIds?.length && offer === undefined) {
        offer = tagSharing(ownTags, tagIds);
        args = { share: offer };
      }
      const received = open.find((row) => row.toUserId === userId && row.fromAddress === to);
      if (received) {
        if (agentId) return new BrokerError("invalid_input", "Esta persona ya te invitó. Revisa la invitación recibida.");
        await closeInvitation(tx, received, true, offer, "owner");
        crossedInvitationAccepted = true;
      }
      if (tagIds?.length) await tags.tagContact(tx, userId, to, tagIds, agentId ? "agent" : "owner", false);
      else await tx.setContactTags(userId, to, []);
    }
    let row = await initialRequest({
      fromUserId: userId, fromAddress: from, toUserId: recipient?.userId ?? null, toAddress: to, tool, args, purpose,
      originChannel: channel,
    }, now);
    const invitation = recipient && tool === "connect";
    const accessRequest = tool === "vault_access" && recipient && (await tx.listContactAddresses(recipient.userId)).includes(from);
    const category = categoryOf(tool, args);
    // The request keeps separate display text.
    const ruleCode = accessRequest ? "vault_access_request" : invitation ? "connection_request"
      : !recipient ? "no_recipient"
      : category ? await sharingRule(tx, recipient.userId, to, from, category) : "no_grant";
    const allowed = ruleCode === "grant" || ruleCode === "circle";
    record(tx, "broker.policy.evaluated", {
      requestId: row.id, userId, ...(agentId ? { agentId } : {}),
      attrs: { tool, ...(category ? { category } : {}), decision: accessRequest || invitation || allowed ? "allow" : "deny", rule: ruleCode },
    });
    if (crossedInvitationAccepted) {
      row = await finalize({
        ...row, status: "awaiting_agent", allowedFields: connectionFields, rule: "Invitación mutua",
      }, "answered", now, { accepted: true });
    } else if (accessRequest) {
      row = { ...row, status: "awaiting_owner", rule: "Solicitud de lectura de la bóveda" };
    } else if (invitation) {
      row = {
        ...row, status: "awaiting_agent", allowedFields: connectionFields,
        rule: "Solicitud de conexión", guidance: connectionGuidance,
      };
    } else if (allowed && category) {
      row = {
        ...row, status: "awaiting_agent", allowedFields: fieldsOf(tool),
        rule: `Permiso para la categoría ${categories[category].label}`,
        guidance: tool === "question" ? questionGuidance : "",
      };
    } else {
      const decisionReason = recipient ? "Sin permiso para esta categoría." : "Dirección sin destinatario.";
      row = await finalize({ ...row, decisionReason }, "denied", now);
    }
    await persistNewRequest(tx, row, now, ruleCode, agentId);
    return toRequesterView(row);
  }

  type InitialRequest = Pick<RequestRow, "fromAddress" | "toAddress" | "fromUserId" | "toUserId" | "tool" | "args"> &
    Partial<Pick<RequestRow, "targetAgentId" | "purpose" | "originChannel">>;

  function initialRequest(input: InitialRequest, now: Date): Promise<RequestRow> {
    return seal({
      ...input,
      id: randomUUID(),
      status: "awaiting_owner",
      allowedFields: [],
      rule: "",
      guidance: "",
      escalated: false,
      envelopeSignature: "",
      createdAt: now,
      expiresAt: deadline(now),
      version: 0,
    });
  }

  async function persistNewRequest(tx: StoreTx, row: RequestRow, now: Date, rule: string, agentId?: string) {
    await tx.insertRequest(row);
    record(tx, "broker.request.created", {
      requestId: row.id,
      userId: row.fromUserId ?? row.toUserId,
      ...(agentId ? { agentId } : {}),
      attrs: { tool: row.tool, rule, ...(row.targetAgentId ? { targetAgentId: row.targetAgentId } : {}) },
    });
    if (row.closedAt) {
      record(tx, "broker.request.closed", {
        requestId: row.id, attrs: { outcome: row.status, escalated: row.escalated },
      });
    }
    await tx.appendEvent({ requestId: row.id, at: now, kind: "received" });
    await tx.appendEvent({ requestId: row.id, at: now, kind: "permission", status: row.status });
    if (row.status === "awaiting_agent") await enqueue(tx, row, now, row.version);
    if (row.closedAt) await tx.appendEvent({ requestId: row.id, at: now, kind: "delivery", status: row.status });
  }

  // Cancel pending work atomically if the old authorization is no longer valid.
  // Already queued notices carry only an ID and must re-read the inbox.
  async function denyUnauthorizedInboxRequests(tx: StoreTx, userId: string): Promise<void> {
    const owner = await tx.getUser(userId);
    if (!owner?.address) return;
    for (const row of await tx.listInbox(owner.address)) {
      if (await stillAuthorized(tx, row, userId)) continue;
      const now = clock.now();
      const denied = await finalize(transition(row, "denied"), "denied", now);
      if (!await saveTransition(tx, row, denied)) throw closed();
      await recordTransitionAndScheduleOriginWake(tx, row, denied, "owner");
      await tx.appendEvent({ requestId: row.id, at: now, kind: "delivery", status: "denied" });
    }
  }

  async function ask(userId: string, input: unknown, origin: { principal?: Principal; channel?: ChannelName }) {
    const { principal, channel } = origin;
    const parsed = AskInput.safeParse(input);
    if (!parsed.success) {
      throw new BrokerError("invalid_input", invalidInputMessage("La pregunta no cumple el formato de la herramienta.", parsed.error));
    }
    if (principal && parsed.data.tool === "connect" && parsed.data.tags?.length) requireScope(principal, "changeTag");
    const view = await store.tx(async (tx) => {
      if (principal) await ensureActiveAgentConnection(tx, principal);
      const sender = { userId, agentId: principal?.agentId, channel };
      return submitOnce(tx, sender, parsed.data, record, () => submit(tx, userId, parsed.data, sender));
    });
    if (view instanceof BrokerError) throw view;
    return view;
  }

  async function status(userId: string, id: string, principal?: Principal) {
    const view = await store.tx(async (tx) => {
      if (principal) await ensureActiveAgentConnection(tx, principal);
      const row = await tx.getRequest(id, { fromUserId: userId });
      if (!row) return notFound();
      if (row.status === "answered" && row.answeredByAgentId && row.toUserId &&
          !await stillAuthorized(tx, row, row.toUserId)) {
        return toRequesterView(await finalize(row, "denied", clock.now()));
      }
      return toRequesterView(row);
    });
    if (view instanceof BrokerError) throw view;
    return view;
  }

  async function directory(tx: StoreTx, userId: string) {
    const contacts = (await tx.listContacts(userId))
      .map(({ gives, receives, ...identity }) => ({ ...identity, theyShare: receives, youShare: gives }));
    return { contacts, circles: await tx.listJoinedCircles(userId) };
  }

  async function searchProfiles(tx: StoreTx, userId: string, query: string, agentId?: string) {
    const parsed = ProfileSearch.safeParse({ query });
    if (!parsed.success) throw new BrokerError("invalid_input", "Escribe entre 2 y 100 caracteres para buscar.");
    const profiles = await tx.searchPublicProfiles(parsed.data.query);
    record(tx, "broker.profiles.searched", { userId, agentId, attrs: { count: profiles.length } });
    return profiles;
  }

  async function queryVault(tx: StoreTx, userId: string, input: VaultQuery, agentId?: string) {
    const query = VaultQuery.safeParse(input);
    if (!query.success) throw new BrokerError("invalid_input", "Revisa la dirección y la categoría.");
    const reader = (await tx.getUser(userId))?.address;
    const result = reader ? await tx.sharedVault(reader, query.data.to, query.data.categoryId) : { categories: [] };
    record(tx, "broker.vault.queried", { userId, agentId,
      attrs: { lookup: query.data.categoryId ? "entries" : "categories", visible: result.categories.length > 0 } });
    return result;
  }

  async function changeVault(tx: StoreTx, userId: string, input: VaultChange, agentId?: string) {
    const parsed = VaultChange.safeParse(input);
    if (!parsed.success) throw new BrokerError("invalid_input", "Revisa los datos de la categoría.");
    if (!(await tx.getUser(userId))?.address) throw new BrokerError("invalid_input", "Primero elige tu dirección Sideband.");
    const change = parsed.data;
    const categoryId = change.action === "create" ? randomUUID() : change.categoryId;
    if (change.action === "set_tag") await tags.knownTags(tx, userId, [change.tagId]);
    if (!await tx.changeVault(userId, categoryId, change)) throw notFound();
    record(tx, "broker.vault.changed", { userId, agentId, attrs: { action: change.action,
      ...(change.action === "set_tag" || change.action === "set_member" ? { allowed: change.allowed } : {}),
      ...(change.action === "set_visibility" ? { visibility: change.visibility } : {}) } });
    return { categoryId };
  }

  function documentMetadata(row: VaultDocumentRow): VaultDocumentMetadata {
    return {
      id: row.id,
      fileName: row.fileName,
      ...(row.mimeType ? { mimeType: row.mimeType } : {}),
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      createdAt: row.createdAt.toISOString(),
    };
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

  async function removeContact(o: Owner, contact: Address) {
    if (!Address.safeParse(contact).success) throw new BrokerError("invalid_input", "La dirección no es válida.");
    await store.tx(async (tx) => {
      const me = (await tx.getUser(o.userId))?.address;
      const other = await tx.getUserByAddress(contact);
      const sides = [{ userId: o.userId, address: contact }];
      if (other && me) sides.push({ userId: other.userId, address: me });
      sides.sort((a, b) => a.userId.localeCompare(b.userId));
      let removed = false;
      for (const { userId, address } of sides) {
        removed = await tx.removeContact(userId, address) || removed;
      }
      if (!removed) return;
      for (const { userId, address } of sides) {
        await tx.setContactTags(userId, address, []);
        await grants.applySharing(tx, userId, address, []);
        await denyUnauthorizedInboxRequests(tx, userId);
      }
      record(tx, "broker.contact.removed", { userId: o.userId });
    });
  }

  return {
    agent: {
      async connect(p) {
        await store.tx(tx => ensureActiveAgentConnection(tx, p));
      },
      async tags(p) {
        requireScope(p, "tags");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          return tags.view(tx, p.userId);
        });
      },
      async changeTag(p, input) {
        requireScope(p, "changeTag");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          return tags.changeByAgent(tx, p, input);
        });
      },
      async vaultCatalog(p, categoryId) {
        requireScope(p, "vaultCatalog");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          if (!categoryId) return tx.vaultCatalog(p.userId);
          const category = (await tx.ownerVault(p.userId)).categories.find(c => c.id === categoryId);
          if (!category) throw notFound();
          return { categories: [category] };
        });
      },
      async vaultMembers(p, categoryId) {
        requireScope(p, "vaultMembers");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          const members = await tx.vaultMembers(p.userId, categoryId);
          if (!members) throw notFound();
          return { members };
        });
      },
      async changeVault(p, change) {
        requireScope(p, "changeVault");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          return changeVault(tx, p.userId, change, p.agentId);
        });
      },
      async queryVault(p, input) {
        requireScope(p, "queryVault");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          return queryVault(tx, p.userId, input, p.agentId);
        });
      },
      async uploadVaultDocument(p, input) {
        requireScope(p, "uploadVaultDocument");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          return uploadVaultDocument(tx, p.userId, input, p.agentId);
        });
      },
      async downloadVaultDocument(p, input) {
        requireScope(p, "downloadVaultDocument");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          return downloadVaultDocument(tx, p.userId, input, p.agentId);
        });
      },
      async capabilities(p, to) {
        requireScope(p, "capabilities");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          const from = (await tx.getUser(p.userId))?.address;
          const owner = await tx.getUserByAddress(to);
          if (!from || !owner || from === to) return { tools: [] };
          const shared: Category[] = [];
          for (const category of Category.options) {
            if (await sharingRule(tx, owner.userId, to, from, category) !== "no_grant") shared.push(category);
          }
          const tools = ToolName.options.flatMap((tool) => {
            const allowed = shared.filter((category) => categories[category].tools.includes(tool));
            return allowed.length > 0 ? [describeTool(tool, allowed)] : [];
          });
          tools.push(describeTool("connect", []));
          return { tools };
        });
      },

      async ask(p, input) {
        requireScope(p, "ask");
        return ask(p.userId, input, { principal: p });
      },

      async inbox(p, includeInvitations = false) {
        requireScope(p, "inbox");
        return store.tx(async (tx) => {
          await ensureActiveAgentConnection(tx, p);
          const address = (await tx.getUser(p.userId))?.address;
          if (!address) return [];
          const now = clock.now();
          const rows = await tx.listInbox(address);
          if (includeInvitations) rows.push(...(await tx.listOwnerPending(address)).filter((row) => row.tool === "connect"));
          return rows
            .filter((row) => row.toUserId === p.userId && (row.targetAgentId === undefined || row.targetAgentId === p.agentId) && row.expiresAt > now)
            .map((row) => toInboxItem(row, deriveNonce(nonceKey, row.id)));
        });
      },

      async reply(p, input) {
        requireScope(p, "reply");
        const parsed = ReplyInput.safeParse(input);
        if (!parsed.success) {
          telemetry?.emit("broker.reply.rejected", {
            userId: p.userId, agentId: p.agentId, attrs: { code: "schema" },
          });
          throw new BrokerError("invalid_input", invalidInputMessage("La respuesta no cumple el formato requerido.", parsed.error));
        }
        const { requestId, nonce } = parsed.data;
        const result = await store.tx<ReplyReceipt | BrokerError>(async (tx) => {
          const connection = await ensureActiveAgentConnection(tx, p);
          const row = await tx.getRequest(requestId, { toUserId: p.userId });
          if (!row || (row.targetAgentId !== undefined && row.targetAgentId !== p.agentId)) {
            record(tx, "broker.reply.rejected", { requestId, attrs: { code: "not_recipient" } });
            return notFound();
          }

          const now = clock.now();
          async function reject(error: BrokerError): Promise<BrokerError> {
            await tx.appendEvent({ requestId, at: now, kind: "response", code: error.code });
            const flags = error instanceof SanitizeBlockedError ? flagCodes(error.flags) : "";
            record(tx, "broker.reply.rejected", {
              requestId, attrs: { code: rejectionCode(error), ...(flags && { flags }) },
            });
            return error;
          }
          const answeringInvitation = row.tool === "connect" && parsed.data.outcome === "answered";
          if (row.status !== "awaiting_agent" && !(answeringInvitation && row.status === "awaiting_owner")) return reject(closed());
          if (row.expiresAt <= now) {
            const changed = await closePending(tx, row, "expired", now);
            return reject(changed ? expired() : closed());
          }
          if (!hasNonce(nonceKey, row.id, nonce)) {
            return reject(new BrokerError("forbidden", "El nonce no coincide."));
          }
          if (answeringInvitation) {
            if (!parsed.data.share || ToolResultSchemas.connect.safeParse(parsed.data.result).data?.accepted !== true) {
              return reject(new BrokerError("invalid_input", "Para aceptar, incluye accepted: true y las categorías elegidas por tu titular."));
            }
            requireScope(p, "reply.connect");
          } else if (parsed.data.share !== undefined) {
            return reject(new BrokerError("invalid_input", "Solo una aceptación lleva categorías para compartir."));
          }
          let response: Awaited<ReturnType<typeof prepareAgentReply>>;
          try {
            response = await prepareAgentReply(row, parsed.data, p.agentId, now);
          } catch (error) {
            if (error instanceof BrokerError) return reject(error);
            throw error;
          }
          const { changed, receipt, flags } = response;
          if (!await saveTransition(tx, row, changed)) return reject(closed());
          if (answeringInvitation) await applyConnection(tx, changed, parsed.data.share);
          await recordTransitionAndScheduleOriginWake(tx, row, changed, "agent");
          if (flags.length > 0 || changed.droppedFields.length > 0) {
            record(tx, "broker.reply.sanitized", {
              requestId,
              attrs: {
                ...(flags.length > 0 && { flags: flagCodes(flags) }),
                ...(changed.droppedFields.length > 0 && { dropped: changed.droppedFields.join(",") }),
              },
            });
          }
          await tx.appendEvent({ requestId: row.id, at: now, kind: "response", status: changed.status });
          if (changed.closedAt) await tx.appendEvent({ requestId: row.id, at: now, kind: "delivery", status: changed.status });
          if (row.targetAgentId !== undefined) await tx.upsertAgentConnection({ ...connection, verifiedAt: now });
          return receipt;
        });
        // Returning the error inside tx commits the expiry and any authorized audit event.
        if (result instanceof BrokerError) throw result;
        return result;
      },

      async searchPublicProfiles(p, query) {
        requireScope(p, "searchPublicProfiles");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          return searchProfiles(tx, p.userId, query, p.agentId);
        });
      },

      async networkUsers(p, after, q) {
        requireScope(p, "networkUsers");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          const pageSize = 50;
          const rows = await tx.networkAddresses(after, pageSize + 1, q);
          const addresses = rows.slice(0, pageSize);
          return { addresses, ...(rows.length > pageSize ? { nextCursor: addresses.at(-1) } : {}) };
        });
      },
      async contacts(p) {
        requireScope(p, "contacts");
        return store.tx(async (tx) => {
          await ensureActiveAgentConnection(tx, p);
          return directory(tx, p.userId);
        });
      },

      async status(p, id) {
        requireScope(p, "status");
        return status(p.userId, id, p);
      },

      async connectWake(p, target) {
        requireScope(p, "connectWake");
        const parsed = WakeTarget.safeParse(target);
        if (!parsed.success) throw new BrokerError("invalid_input", "La configuración del aviso no es válida.");
        const wakeTarget = parsed.data;
        if (wakeTarget.kind === "mcp_events") {
          await store.tx((tx) => ensureActiveAgentConnection(tx, p));
          const fields = { userId: p.userId, agentId: p.agentId };
          let errorId: string | undefined;
          const verification = await waker.verifyCallback(wakeTarget).catch((error: unknown) => {
            errorId = telemetry?.error?.("wake.verify_callback", error, fields);
            return { ok: false, reason: "challenge_failed" } as const;
          });
          const reason = verification.ok ? undefined : verification.reason;
          telemetry?.emit("wake.callback_verification", { ...fields, attrs: { ok: verification.ok, reason } });
          if (reason) throw new BrokerError("invalid_input", reason, { errorId, reason });
        }
        return store.tx(async (tx) => {
          const connection = await ensureActiveAgentConnection(tx, p);
          const updated = { ...connection, wakeTarget };
          await tx.upsertAgentConnection(updated);
          return toAgentConnection(updated);
        });
      },

      async disconnectWake(p, subscriptionId) {
        requireScope(p, "disconnectWake");
        await store.tx(async (tx) => {
          const connection = await ensureActiveAgentConnection(tx, p);
          if (connection.wakeTarget.kind !== "mcp_events" || connection.wakeTarget.subscriptionId !== subscriptionId) {
            throw notFound();
          }
          await tx.upsertAgentConnection({ ...connection, wakeTarget: { kind: "none" } });
        });
      },
    },

    owner: {
      ...tags.port,
      vault: o => store.tx(tx => tx.ownerVault(o.userId)),
      changeVault: (o, change) => store.tx(tx => changeVault(tx, o.userId, change)),
      ask: (o, input, channel) => ask(o.userId, input, { channel }),
      status: (o, id) => status(o.userId, id),

      async me(o) {
        return store.tx(async (tx) => {
          const user = await tx.getUser(o.userId);
          return { userId: o.userId, address: user?.address, displayName: user?.displayName };
        });
      },

      async claimAddress(o, localPart) {
        if (!LocalPart.safeParse(localPart).success || localPart === systemLocalPart) {
          throw new BrokerError("invalid_input", "Elige una parte local válida y disponible.");
        }
        const address = `${localPart}@${config.addressDomain}`;
        await store.tx((tx) => tx.createAddress(o.userId, address));
        return address;
      },

      async grants(o) {
        return store.tx(async (tx) => (await tx.listGrants(o.userId)).map(toGrant));
      },

      async setGrant(o, input) {
        const parsed = GrantInput.safeParse(input);
        if (!parsed.success) throw new BrokerError("invalid_input", "El permiso no es válido.");
        const { grantee, category } = parsed.data;
        return store.tx(async (tx) => {
          if ((await tx.getUser(o.userId))?.address === grantee) {
            throw new BrokerError("invalid_input", "Elige una dirección distinta a la tuya.");
          }
          return toGrant(await grants.putGrant(tx, o.userId, grantee, category));
        });
      },

      async revokeGrant(o, grantId) {
        await store.tx(async (tx) => {
          if (!await grants.revokeGrant(tx, o.userId, grantId)) throw notFound();
          await denyUnauthorizedInboxRequests(tx, o.userId);
        });
      },

      async pending(o) {
        return store.tx(async (tx) => {
          const address = (await tx.getUser(o.userId))?.address;
          if (!address) return [];
          const now = clock.now();
          return (await tx.listOwnerPending(address))
            .filter((row) => row.toUserId === o.userId && row.expiresAt > now)
            .map(toOwnerPendingItem);
        });
      },

      async activity(o, query = {}) {
        const { limit = 30, requestId } = typeof query === "number" ? { limit: query } : query;
        if (!Number.isSafeInteger(limit) || limit < 1) {
          throw new BrokerError("invalid_input", "El límite de actividad debe ser un entero positivo.");
        }
        return store.tx(async (tx) => {
          const address = (await tx.getUser(o.userId))?.address;
          if (!address) return [];
          const rows = (await tx.listActivity(address, limit, requestId))
            .filter((row) => row.fromUserId === o.userId || row.toUserId === o.userId);
          const events = await tx.listEvents(rows.map((row) => row.id));
          return rows.map((row) => toActivityItem(row, events.filter((event) => event.requestId === row.id), o.userId));
        });
      },

      async decide(o, requestId, input) {
        const error = await store.tx(async (tx) => {
          const row = await tx.getRequest(requestId, { toUserId: o.userId });
          if (!row) throw notFound();
          if (row.status !== "awaiting_owner") throw closed();
          const now = clock.now();
          if (row.expiresAt <= now) return await closePending(tx, row, "expired", now) ? expired() : closed();

          const parsed = OwnerDecision.safeParse(input);
          if (!parsed.success) throw new BrokerError("invalid_input", "La decisión no cumple el formato requerido.");
          const decision = parsed.data;
          let changed: RequestRow;
          if (decision.kind === "grant_vault_read") {
            if (row.tool !== "vault_access") throw new BrokerError("invalid_input", "Esta solicitud no pide acceso a la bóveda.");
            changed = await finalize(transition(row, "answered"), "answered", now, { accepted: true });
          } else if (row.tool === "vault_access" && decision.kind !== "deny") {
            throw new BrokerError("invalid_input", "Elige conceder lectura o rechazar.");
          } else if (decision.kind === "approve_once") {
            changed = approveOnce(row);
          } else if (decision.kind === "deny") {
            changed = await finalize(transition(row, "declined"), "declined", now);
          } else {
            changed = await finalize(transition(row, "answered"), "answered", now, parseResult(row.tool, decision.result));
          }
          if (!await saveTransition(tx, row, changed)) throw closed();
          if (decision.kind === "grant_vault_read") {
            const { categoryName } = ToolArgs.vault_access.parse(row.args);
            const { categories } = await tx.vaultCatalog(o.userId, true);
            const matches = categories.filter(c => c.name.toLowerCase() === categoryName.toLowerCase());
            if (matches.length > 1) throw new BrokerError("conflict", "Hay varias categorías con ese nombre. Distingue sus nombres antes de aceptar.");
            const categoryId = matches[0]?.id ?? (await changeVault(tx, o.userId, { action: "create", name: categoryName })).categoryId;
            await changeVault(tx, o.userId, { action: "set_member", categoryId, address: row.fromAddress, allowed: true });
          }
          await applyConnection(tx, changed);
          record(tx, "broker.owner.decided", { requestId, userId: o.userId, attrs: { decision: decision.kind } });
          await recordTransitionAndScheduleOriginWake(tx, row, changed, "owner");
          await tx.appendEvent({ requestId, at: now, kind: "permission", status: changed.status });
          if (decision.kind === "approve_once") {
            await enqueue(tx, row, now, row.version + 1);
          } else {
            await tx.appendEvent({ requestId, at: now, kind: "delivery", status: changed.status });
          }
        });
        if (error) throw error;
      },

      directory: o => store.tx(tx => directory(tx, o.userId)),
      queryVault: (o, input) => store.tx(tx => queryVault(tx, o.userId, input)),
      searchPublicProfiles: (o, query) => store.tx(tx => searchProfiles(tx, o.userId, query)),

      async agentDirectory() {
        return store.tx((tx) => tx.listPublicAgents());
      },

      async agents(o) {
        return store.tx(async (tx) => (await tx.listAgentConnections(o.userId)).map(toAgentConnection));
      },

      async setWake(o, agentId, target) {
        const parsed = WakeTarget.safeParse(target);
        if (!parsed.success) throw new BrokerError("invalid_input", "La configuración del aviso no es válida.");
        await store.tx(async (tx) => {
          const connection = await tx.getAgentConnection(o.userId, agentId, true);
          if (!connection || connection.revokedAt) throw notFound();
          await tx.upsertAgentConnection({ ...connection, wakeTarget: parsed.data });
        });
      },

      async setChannel(o, name, target) {
        const channel = ChannelName.safeParse(name);
        const parsed = WakeTarget.safeParse(target);
        if (!channel.success || !parsed.success) throw new BrokerError("invalid_input", "La configuración del canal no es válida.");
        await store.tx(async (tx) => {
          await tx.putChannel({ userId: o.userId, name: channel.data, wakeTarget: parsed.data, createdAt: clock.now() });
          record(tx, "broker.channel.set", { userId: o.userId, attrs: { channel: channel.data, kind: parsed.data.kind } });
        });
      },

      async ping(o, agentId) {
        return store.tx(async (tx) => {
          const connection = await tx.getAgentConnection(o.userId, agentId, true);
          if (!connection || connection.revokedAt) throw notFound();
          const address = (await tx.getUser(o.userId))?.address;
          if (!address) throw new BrokerError("invalid_input", "Primero elige tu dirección en la App Sideband.");
          const now = clock.now();
          const row: RequestRow = {
            ...await initialRequest({
              fromAddress: systemAddress, toAddress: address, fromUserId: null, toUserId: o.userId,
              targetAgentId: agentId, tool: "question",
              args: { text: "Prueba de conexión de Sideband: responde con outcome no_data", category: "general" },
            }, now),
            status: "awaiting_agent",
            rule: "Prueba de conexión solicitada por el dueño",
            allowedFields: fieldsOf("question"),
          };
          await persistNewRequest(tx, row, now, "ping");
          return { requestId: row.id };
        });
      },

      async connect(o, invitation) {
        const input = ConnectInput.safeParse(invitation);
        if (!input.success) throw new BrokerError("invalid_input", "La invitación no es válida.");
        const { to, share, tags: tagIds } = input.data;
        const view = await store.tx(async (tx) => {
          return submit(tx, o.userId, { to, tool: "connect", args: { share }, tags: tagIds }, {});
        });
        if (view instanceof BrokerError) throw view;
        return view;
      },

      async contacts(o) {
        return store.tx(async (tx) => {
          const contacts = await tx.listContacts(o.userId);
          const now = clock.now();
          const open = (await tx.listOpenInvitations(o.userId)).filter((row) => row.expiresAt > now);
          const invitation = (row: RequestRow, address: Address) => ({
            requestId: row.id, address, offer: offerOf(row), expiresAt: row.expiresAt.toISOString(),
          });
          return {
            contacts,
            tags: await tx.listTags(o.userId),
            incoming: open.filter((row) => row.toUserId === o.userId).map((row) => invitation(row, row.fromAddress)),
            outgoing: open.filter((row) => row.fromUserId === o.userId).map((row) => invitation(row, row.toAddress)),
          };
        });
      },

      async setSharing(o, contact, sharing) {
        const address = Address.safeParse(contact);
        const parsed = Sharing.safeParse(sharing);
        if (!address.success || !parsed.success) throw new BrokerError("invalid_input", "Lo que compartes no es válido.");
        await store.tx(async (tx) => {
          if (!(await tx.listContactAddresses(o.userId)).includes(address.data)) throw notFound();
          await grants.applySharing(tx, o.userId, address.data, parsed.data);
          await denyUnauthorizedInboxRequests(tx, o.userId);
        });
      },

      async answerInvitation(o, requestId, answer) {
        const parsed = InvitationAnswer.safeParse(answer);
        if (!parsed.success) throw new BrokerError("invalid_input", "La respuesta no es válida.");
        const error = await store.tx(async (tx) => {
          const row = await tx.getRequest(requestId, { toUserId: o.userId });
          if (!row || row.tool !== "connect") throw notFound();
          if (row.status !== "awaiting_agent" && row.status !== "awaiting_owner") throw closed();
          const now = clock.now();
          if (row.expiresAt <= now) return await closePending(tx, row, "expired", now) ? expired() : closed();
          const { accept, tags: tagIds } = parsed.data;
          const ownTags = accept && tagIds?.length ? await tags.knownTags(tx, o.userId, tagIds) : [];
          const share = parsed.data.share ?? (tagIds?.length ? tagSharing(ownTags, tagIds) : undefined);
          await closeInvitation(tx, row, accept, share, "owner");
          if (accept && tagIds?.length) await tags.tagContact(tx, o.userId, row.fromAddress, tagIds, "owner", false);
          record(tx, "broker.owner.decided", { requestId, userId: o.userId, attrs: { decision: parsed.data.accept ? "accept" : "decline" } });
        });
        if (error) throw error;
      },

      ...createCirclePort({ store, clock }, record, denyUnauthorizedInboxRequests),

      removeContact,
      removeFriend: removeContact,

      async revokeAgent(o, agentId) {
        await store.tx((tx) => revokeConnection(tx, o.userId, agentId, clock.now(), (fields) => record(tx, "broker.agent.revoked", { ...fields, attrs: { by: "owner" } })));
      },
    },

    admin: createAdminPort({ store, clock, telemetry }, { closePending, enqueue, record }),

    tick: createWorker({ store, waker, clock, telemetry, wakeRetryDelaysMs: config.wakeRetryDelaysMs }, closePending),
  };
}
