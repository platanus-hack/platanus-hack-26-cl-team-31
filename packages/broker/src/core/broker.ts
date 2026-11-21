import { randomUUID } from "node:crypto";
import {
  Address,
  AskInput,
  CircleName,
  fieldsOf,
  describeTool,
  basicSharing,
  GrantInput,
  GrantTool,
  InvitationAnswer,
  noSharing,
  Sharing,
  sharingFields,
  sharingOf,
  sharingTools,
  ToolArgs,
  LocalPart,
  OwnerDecision,
  ReplyInput,
  WakeTarget,
  WAKE_SUBSCRIPTION_SCOPE,
  type Circle,
  type FinalOutcome,
  type Principal,
  type ReplyReceipt,
  type RequesterView,
  type Scope,
  type ToolName,
  type ToolResult,
} from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import { filterResult } from "../policy/index.js";
import type { BrokerCore, BrokerDeps } from "../ports.js";
import type { CircleRow, RequestRow, StoreTx } from "../store/store.js";
import { createAdminPort, revokeConnection } from "./admin.js";
import { deriveNonce, hasNonce, signJson } from "./crypto.js";
import { approveOnce, escalate, parseResult, transition } from "./lifecycle.js";
import {
  toActivityItem, toAgentConnection, toGrant, toInboxItem, toOwnerPendingItem, toRequesterView,
} from "./views.js";
import { createLifecycleEvents } from "./events.js";
import { createWorker } from "./worker.js";

const connectionFields = fieldsOf("connect");
const connectionGuidance =
  "Cuéntale a tu titular quién quiere conectar. Solo tu titular acepta o rechaza desde la App Sideband: responde needs_owner.";

// Fields shared by members of the same circle.
const basePolicy = [
  { tool: "availability", fields: ["available", "freeSlots"] },
  { tool: "interest_check", fields: ["matches"] },
] satisfies Pick<GrantInput, "tool" | "fields">[];

// What the recipient lets the sender receive for a tool: the fields of their grant, plus the base
// policy while both have joined the same circle.
async function sharedFields(tx: StoreTx, toUserId: string, toAddress: Address, from: Address, tool: ToolName) {
  const grant = await tx.getGrant(toUserId, from, tool);
  const base = basePolicy.find((entry) => entry.tool === tool);
  const circle = base && await tx.shareCircle(toAddress, from) ? base.fields : [];
  return {
    fields: [...new Set([...(grant?.fields ?? []), ...circle])],
    // Stable rule code for telemetry.
    rule: grant ? "grant" : circle.length > 0 ? "circle" : "no_grant",
  };
}

// A request stays authorized while the recipient still shares its fields with the sender.
async function stillAuthorized(tx: StoreTx, row: RequestRow, toUserId: string): Promise<boolean> {
  // Invitations, connection tests and one-time owner approvals have their own consent flow.
  if (row.tool === "connect" || row.fromUserId === null || row.approvedOnce) return true;
  const { fields } = await sharedFields(tx, toUserId, row.toAddress, row.fromAddress, row.tool);
  return fields.length > 0 && row.allowedFields.every(field => fields.includes(field));
}

function notFound(): BrokerError {
  return new BrokerError("not_found", "No se encontró el recurso.");
}

function closed(): BrokerError {
  return new BrokerError("conflict", "La solicitud ya no está pendiente para esta acción.");
}

function expired(): BrokerError {
  return new BrokerError("expired", "La solicitud venció.");
}

type Actor = "agent" | "owner" | "broker" | "admin";

// Code of a rejected reply for broker.reply.rejected (never the message).
function rejectionCode(error: BrokerError) {
  switch (error.code) {
    case "forbidden": return "nonce";
    case "expired": return "expired";
    case "invalid_input": return "schema";
    case "not_found": return "not_recipient";
    default: return "closed";
  }
}

export function createBroker(deps: BrokerDeps): BrokerCore {
  const { clock, config, nonceKey, signingKey, waker, telemetry } = deps;
  const events = createLifecycleEvents(deps.store, deps.telemetry);
  const { store, record } = events;
  const systemAddress = Address.parse(`system@${config.addressDomain}`);

  function requireScope(principal: Principal, scope: Scope, operation: string): void {
    if (principal.scopes.includes(scope)) return;
    events.emit("auth.scope.denied", {
      userId: principal.userId, agentId: principal.agentId, attrs: { scope, operation },
    });
    throw new BrokerError("forbidden", "El agente no tiene permiso para esta acción.");
  }

  // One status_changed per persisted transition, plus closed when it reaches a final state.
  function recordTransition(tx: StoreTx, before: RequestRow, after: RequestRow, by: Actor): void {
    record(tx, "broker.request.status_changed", {
      requestId: before.id, attrs: { from: before.status, to: after.status, by },
    });
    if (after.closedAt) {
      record(tx, "broker.request.closed", {
        requestId: before.id, attrs: { outcome: after.status, escalated: after.escalated },
      });
    }
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
      id: randomUUID(), requestId: row.id, requestVersion, attempt, runAt: now, state: "queued",
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
    recordTransition(tx, row, final, code?.startsWith("admin_") ? "admin" : "broker");
    return true;
  }

  async function prepareAgentReply(row: RequestRow, reply: ReplyInput, agentId: string, now: Date) {
    const { outcome, internalReason } = reply;
    const filtered = outcome === "answered" ? filterResult(row.tool, reply.result, row.allowedFields) : null;
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
    };
  }

  async function ensureActiveAgentConnection(tx: StoreTx, principal: Principal) {
    const { userId, agentId } = principal;
    const connection = await tx.ensureAgentConnection({
      userId, agentId, label: agentId, wakeTarget: { kind: "none" }, createdAt: clock.now(),
    });
    if (connection.revokedAt) throw notFound();
    return connection;
  }

  async function applySharing(tx: StoreTx, userId: string, address: Address, sharing: Sharing): Promise<void> {
    const wanted = sharingFields(sharing);
    for (const tool of sharingTools) {
      const fields = wanted[tool];
      const live = await tx.getGrant(userId, address, tool);
      if (!fields) {
        if (live && await tx.revokeGrant(live.id, userId, clock.now())) {
          record(tx, "broker.grant.revoked", { userId, attrs: { grantId: live.id } });
        }
        continue;
      }
      if (live && live.fields.length === fields.length && fields.every((field) => live.fields.includes(field))) continue;
      const grant = await tx.putGrant({
        id: randomUUID(), grantorUserId: userId, granteeAddress: address, tool, fields, createdAt: clock.now(),
      });
      record(tx, "broker.grant.set", { userId, attrs: { grantId: grant.id, tool, fields: fields.length } });
    }
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
      if (!await tx.addFriend(userId, address)) continue;
      await applySharing(tx, userId, address, share);
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
    recordTransition(tx, row, changed, by);
    await tx.appendEvent({ requestId: row.id, at: now, kind: "permission", status: changed.status });
    await tx.appendEvent({ requestId: row.id, at: now, kind: "delivery", status: changed.status });
  }

  // A repeated invitation returns the open one. Crossed invitations accept the received one.
  async function existingInvitation(
    tx: StoreTx, userId: string, to: Address, share: Sharing | undefined, byAgent: boolean,
  ): Promise<RequesterView | BrokerError | "accepted" | null> {
    if ((await tx.listFriends(userId)).includes(to)) return new BrokerError("invalid_input", "Ya son contactos.");
    const now = clock.now();
    const open = (await tx.listOpenInvitations(userId)).filter((row) => row.expiresAt > now);
    const sent = open.find((row) => row.fromUserId === userId && row.toAddress === to);
    if (sent) return toRequesterView(sent);
    const received = open.find((row) => row.toUserId === userId && row.fromAddress === to);
    if (!received) return null;
    if (byAgent) return new BrokerError("invalid_input", "Esta persona ya te invitó. Tu titular la acepta desde la App Sideband.");
    await closeInvitation(tx, received, true, share, "owner");
    return "accepted";
  }

  async function submit(
    tx: StoreTx, userId: string, input: AskInput, agentId?: string,
  ): Promise<RequesterView | BrokerError> {
    const { to, tool, args, purpose } = input;
    const from = (await tx.getUser(userId))?.address;
    if (!from) return new BrokerError("invalid_input", "Primero elige tu dirección en la App Sideband.");
    if (from === to) return new BrokerError("invalid_input", "Elige una dirección distinta a la tuya.");
    const recipient = await tx.getUserByAddress(to);
    const offer = input.tool === "connect" ? input.args.share : undefined;
    const existing = recipient && tool === "connect" ? await existingInvitation(tx, userId, to, offer, agentId !== undefined) : null;
    if (existing instanceof BrokerError || (existing && existing !== "accepted")) return existing;
    const now = clock.now();
    let row = await initialRequest({
      fromUserId: userId, fromAddress: from, toUserId: recipient?.userId ?? null, toAddress: to, tool, args, purpose,
    }, now);
    const invitation = recipient && tool === "connect";
    const shared = recipient && !invitation
      ? await sharedFields(tx, recipient.userId, to, from, tool)
      : { fields: [], rule: "no_recipient" };
    const allowed = shared.fields.length > 0;
    // The request keeps separate display text.
    const ruleCode = invitation ? "connection_request" : shared.rule;
    record(tx, "broker.policy.evaluated", {
      requestId: row.id, userId, ...(agentId ? { agentId } : {}),
      attrs: { tool, decision: invitation || allowed ? "allow" : "deny", rule: ruleCode },
    });
    if (existing === "accepted") {
      row = await finalize({
        ...row, status: "awaiting_agent", allowedFields: connectionFields, rule: "Invitación mutua",
      }, "answered", now, { accepted: true });
    } else if (invitation) {
      row = {
        ...row, status: "awaiting_agent", allowedFields: connectionFields,
        rule: "Solicitud de conexión", guidance: connectionGuidance,
      };
    } else if (allowed) {
      row = {
        ...row, status: "awaiting_agent", allowedFields: shared.fields,
        rule: `Permiso para ${tool}: ${shared.fields.join(", ")}`,
      };
    } else {
      const decisionReason = recipient ? "Sin permiso para esta herramienta." : "Dirección sin destinatario.";
      row = await finalize({ ...row, decisionReason }, "denied", now);
    }
    await recordNew(tx, row, now, ruleCode, agentId);
    return toRequesterView(row);
  }

  type InitialRequest = Pick<RequestRow, "fromAddress" | "toAddress" | "fromUserId" | "toUserId" | "tool" | "args"> &
    Partial<Pick<RequestRow, "targetAgentId" | "purpose">>;

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

  async function recordNew(tx: StoreTx, row: RequestRow, now: Date, rule: string, agentId?: string) {
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
  async function cancelUnauthorized(tx: StoreTx, userId: string): Promise<void> {
    const owner = await tx.getUser(userId);
    if (!owner?.address) return;
    for (const row of await tx.listInbox(owner.address)) {
      if (await stillAuthorized(tx, row, userId)) continue;
      const now = clock.now();
      const denied = await finalize(transition(row, "denied"), "denied", now);
      if (!await saveTransition(tx, row, denied)) throw closed();
      recordTransition(tx, row, denied, "owner");
      await tx.appendEvent({ requestId: row.id, at: now, kind: "delivery", status: "denied" });
    }
  }

  async function ask(userId: string, input: unknown, principal?: Principal) {
    const parsed = AskInput.safeParse(input);
    if (!parsed.success) throw new BrokerError("invalid_input", "La pregunta no cumple el formato de la herramienta.");
    const view = await store.tx(async (tx) => {
      if (principal) await ensureActiveAgentConnection(tx, principal);
      return submit(tx, userId, parsed.data, principal?.agentId);
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

  // Close the pending requests that a membership change left without permission.
  async function cancelForMembers(tx: StoreTx, addresses: Address[]): Promise<void> {
    for (const address of addresses) {
      const user = await tx.getUserByAddress(address);
      if (user) await cancelUnauthorized(tx, user.userId);
    }
  }

  async function ownedCircle(tx: StoreTx, userId: string, circleId: string): Promise<CircleRow> {
    const circle = await tx.getCircle(circleId);
    if (circle?.ownerUserId !== userId) throw notFound();
    return circle;
  }

  async function toCircle(tx: StoreTx, row: CircleRow): Promise<Circle> {
    const owner = (await tx.getUser(row.ownerUserId))?.address;
    if (!owner) throw new BrokerError("internal", "El círculo no tiene creador con dirección.");
    const members = await tx.listCircleMembers(row.id);
    return {
      id: row.id, name: row.name, owner,
      members: members.map(({ address, joinedAt }) => ({ address, joined: joinedAt !== undefined })),
    };
  }

  // Addresses stay out of telemetry: only the circle and what happened to it.
  function recordCircle(tx: StoreTx, userId: string, circleId: string, action: "created" | "deleted" | "invited" | "joined" | "removed") {
    record(tx, "broker.circle.changed", { userId, attrs: { circleId, action } });
  }

  return {
    agent: {
      async capabilities(p, to) {
        requireScope(p, "sideband:ask", "agent.capabilities");
        return store.tx(async tx => {
          await ensureActiveAgentConnection(tx, p);
          const from = (await tx.getUser(p.userId))?.address;
          const owner = await tx.getUserByAddress(to);
          if (!from || !owner || from === to) return { tools: [] };
          const shared = await Promise.all(GrantTool.options.map(async tool =>
            ({ tool, fields: (await sharedFields(tx, owner.userId, to, from, tool)).fields })));
          const tools = shared.flatMap(({ tool, fields }) => fields.length > 0 ? [describeTool(tool, fields)] : []);
          tools.push(describeTool("connect", connectionFields));
          return { tools };
        });
      },

      async ask(p, input) {
        requireScope(p, "sideband:ask", "agent.ask");
        return ask(p.userId, input, p);
      },

      async inbox(p) {
        requireScope(p, "sideband:inbox", "agent.inbox");
        return store.tx(async (tx) => {
          await ensureActiveAgentConnection(tx, p);
          const address = (await tx.getUser(p.userId))?.address;
          if (!address) return [];
          const now = clock.now();
          return (await tx.listInbox(address))
            .filter((row) => row.toUserId === p.userId && (row.targetAgentId === undefined || row.targetAgentId === p.agentId) && row.expiresAt > now)
            .map((row) => toInboxItem(row, deriveNonce(nonceKey, row.id)));
        });
      },

      async reply(p, input) {
        requireScope(p, "sideband:reply", "agent.reply");
        const parsed = ReplyInput.safeParse(input);
        if (!parsed.success) {
          telemetry?.emit("broker.reply.rejected", {
            userId: p.userId, agentId: p.agentId, attrs: { code: "schema" },
          });
          throw new BrokerError("invalid_input", "La respuesta no cumple el formato requerido.");
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
            record(tx, "broker.reply.rejected", { requestId, attrs: { code: rejectionCode(error) } });
            return error;
          }
          if (row.status !== "awaiting_agent") return reject(closed());
          if (row.expiresAt <= now) {
            const changed = await closePending(tx, row, "expired", now);
            return reject(changed ? expired() : closed());
          }
          if (!hasNonce(nonceKey, row.id, nonce)) {
            return reject(new BrokerError("forbidden", "El nonce no coincide."));
          }
          if (row.tool === "connect" && parsed.data.outcome === "answered") {
            return reject(new BrokerError("invalid_input", "Solo el titular acepta una invitación desde la App Sideband. Responde needs_owner."));
          }
          let response: Awaited<ReturnType<typeof prepareAgentReply>>;
          try {
            response = await prepareAgentReply(row, parsed.data, p.agentId, now);
          } catch (error) {
            if (error instanceof BrokerError) return reject(error);
            throw error;
          }
          const { changed, receipt } = response;
          if (!await saveTransition(tx, row, changed)) return reject(closed());
          recordTransition(tx, row, changed, "agent");
          await tx.appendEvent({ requestId: row.id, at: now, kind: "response", status: changed.status });
          if (changed.closedAt) await tx.appendEvent({ requestId: row.id, at: now, kind: "delivery", status: changed.status });
          if (row.targetAgentId !== undefined) await tx.upsertAgentConnection({ ...connection, verifiedAt: now });
          return receipt;
        });
        // Returning the error inside tx commits the expiry and any authorized audit event.
        if (result instanceof BrokerError) throw result;
        return result;
      },

      async status(p, id) {
        requireScope(p, "sideband:status", "agent.status");
        return status(p.userId, id, p);
      },

      async connectWake(p, target) {
        requireScope(p, WAKE_SUBSCRIPTION_SCOPE, "agent.connectWake");
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
        requireScope(p, WAKE_SUBSCRIPTION_SCOPE, "agent.disconnectWake");
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
      ask: (o, input) => ask(o.userId, input),
      status: (o, id) => status(o.userId, id),

      async me(o) {
        return store.tx(async (tx) => {
          const user = await tx.getUser(o.userId);
          return { userId: o.userId, address: user?.address, displayName: user?.displayName };
        });
      },

      async claimAddress(o, localPart) {
        if (!LocalPart.safeParse(localPart).success || localPart === "system") {
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
        const { grantee, tool, fields } = parsed.data;
        return store.tx(async (tx) => {
          if ((await tx.getUser(o.userId))?.address === grantee) {
            throw new BrokerError("invalid_input", "Elige una dirección distinta a la tuya.");
          }
          const grant = await tx.putGrant({
            id: randomUUID(), grantorUserId: o.userId, granteeAddress: grantee, tool, fields, createdAt: clock.now(),
          });
          // The grantee address stays out of telemetry: only the grant id, tool and field count.
          record(tx, "broker.grant.set", {
            userId: o.userId, attrs: { grantId: grant.id, tool, fields: fields.length },
          });
          // Narrowing an existing grant leaves pending requests that expect the old fields.
          await cancelUnauthorized(tx, o.userId);
          return toGrant(grant);
        });
      },

      async revokeGrant(o, grantId) {
        await store.tx(async (tx) => {
          if (!await tx.revokeGrant(grantId, o.userId, clock.now())) throw notFound();
          record(tx, "broker.grant.revoked", { userId: o.userId, attrs: { grantId } });
          await cancelUnauthorized(tx, o.userId);
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

      async activity(o, limit = 30) {
        if (!Number.isSafeInteger(limit) || limit < 1) {
          throw new BrokerError("invalid_input", "El límite de actividad debe ser un entero positivo.");
        }
        return store.tx(async (tx) => {
          const address = (await tx.getUser(o.userId))?.address;
          if (!address) return [];
          const rows = (await tx.listActivity(address, limit))
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
          if (decision.kind === "approve_once") {
            changed = approveOnce(row);
          } else if (decision.kind === "deny") {
            changed = await finalize(transition(row, "declined"), "declined", now);
          } else {
            changed = await finalize(transition(row, "answered"), "answered", now, parseResult(row.tool, decision.result));
          }
          if (!await saveTransition(tx, row, changed)) throw closed();
          await applyConnection(tx, changed);
          record(tx, "broker.owner.decided", { requestId, userId: o.userId, attrs: { decision: decision.kind } });
          recordTransition(tx, row, changed, "owner");
          await tx.appendEvent({ requestId, at: now, kind: "permission", status: changed.status });
          if (decision.kind === "approve_once") {
            await enqueue(tx, row, now, row.version + 1);
          } else {
            await tx.appendEvent({ requestId, at: now, kind: "delivery", status: changed.status });
          }
        });
        if (error) throw error;
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
              targetAgentId: agentId, tool: "question", args: { text: "Prueba de conexión de Sideband: responde con outcome no_data" },
            }, now),
            status: "awaiting_agent",
            rule: "Prueba de conexión solicitada por el dueño",
            allowedFields: fieldsOf("question"),
          };
          await recordNew(tx, row, now, "ping");
          return { requestId: row.id };
        });
      },

      async connect(o, to, share) {
        const target = Address.safeParse(to);
        if (!target.success) throw new BrokerError("invalid_input", "La dirección no es válida.");
        const offer = share === undefined ? undefined : Sharing.safeParse(share);
        if (offer && !offer.success) throw new BrokerError("invalid_input", "Lo que compartes no es válido.");
        const args = offer ? { share: offer.data } : {};
        const view = await store.tx((tx) => submit(tx, o.userId, { to: target.data, tool: "connect", args }));
        if (view instanceof BrokerError) throw view;
        return view;
      },

      async contacts(o) {
        return store.tx(async (tx) => {
          const me = (await tx.getUser(o.userId))?.address;
          const mine = await tx.listGrants(o.userId);
          const contacts = await Promise.all((await tx.listFriends(o.userId)).map(async (address) => {
            const other = await tx.getUserByAddress(address);
            const theirs = other && me ? (await tx.listGrants(other.userId)).filter((grant) => grant.granteeAddress === me) : [];
            return {
              address,
              gives: sharingOf(mine.filter((grant) => grant.granteeAddress === address)),
              receives: sharingOf(theirs),
            };
          }));
          const now = clock.now();
          const open = (await tx.listOpenInvitations(o.userId)).filter((row) => row.expiresAt > now);
          const invitation = (row: RequestRow, address: Address) => ({
            requestId: row.id, address, offer: offerOf(row), expiresAt: row.expiresAt.toISOString(),
          });
          return {
            contacts,
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
          if (!(await tx.listFriends(o.userId)).includes(address.data)) throw notFound();
          await applySharing(tx, o.userId, address.data, parsed.data);
          await cancelUnauthorized(tx, o.userId);
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
          await closeInvitation(tx, row, parsed.data.accept, parsed.data.share, "owner");
          record(tx, "broker.owner.decided", { requestId, userId: o.userId, attrs: { decision: parsed.data.accept ? "accept" : "decline" } });
        });
        if (error) throw error;
      },

      async circles(o) {
        return store.tx(async (tx) => {
          const address = (await tx.getUser(o.userId))?.address;
          if (!address) return [];
          return Promise.all((await tx.listCircles(address)).map((row) => toCircle(tx, row)));
        });
      },

      async createCircle(o, name) {
        const parsed = CircleName.safeParse(name);
        if (!parsed.success) throw new BrokerError("invalid_input", "El nombre del círculo debe tener entre 1 y 60 caracteres.");
        return store.tx(async (tx) => {
          const address = (await tx.getUser(o.userId))?.address;
          if (!address) throw new BrokerError("invalid_input", "Primero elige tu dirección en la App Sideband.");
          const row = { id: randomUUID(), ownerUserId: o.userId, name: parsed.data, createdAt: clock.now() };
          await tx.insertCircle(row);
          await tx.inviteCircleMember(row.id, address);
          await tx.joinCircle(row.id, address, row.createdAt);
          recordCircle(tx, o.userId, row.id, "created");
          return toCircle(tx, row);
        });
      },

      async deleteCircle(o, circleId) {
        await store.tx(async (tx) => {
          const circle = await ownedCircle(tx, o.userId, circleId);
          const members = await tx.listCircleMembers(circle.id);
          await tx.deleteCircle(circle.id);
          recordCircle(tx, o.userId, circle.id, "deleted");
          await cancelForMembers(tx, members.map(({ address }) => address));
        });
      },

      async inviteToCircle(o, circleId, address) {
        if (!Address.safeParse(address).success) throw new BrokerError("invalid_input", "La dirección no es válida.");
        await store.tx(async (tx) => {
          const circle = await ownedCircle(tx, o.userId, circleId);
          await tx.inviteCircleMember(circle.id, address);
          recordCircle(tx, o.userId, circle.id, "invited");
        });
      },

      async joinCircle(o, circleId) {
        await store.tx(async (tx) => {
          const address = (await tx.getUser(o.userId))?.address;
          if (!address) throw notFound();
          if (await tx.joinCircle(circleId, address, clock.now())) {
            recordCircle(tx, o.userId, circleId, "joined");
            return;
          }
          // A repeated join succeeds. Without an invitation the circle stays hidden.
          const members = await tx.listCircleMembers(circleId);
          if (!members.some((member) => member.address === address)) throw notFound();
        });
      },

      async removeFromCircle(o, circleId, address) {
        await store.tx(async (tx) => {
          const circle = await tx.getCircle(circleId);
          const own = (await tx.getUser(o.userId))?.address;
          const isOwner = circle?.ownerUserId === o.userId;
          if (!circle || (!isOwner && own !== address)) throw notFound();
          if (isOwner && own === address) {
            throw new BrokerError("conflict", "Quien creó el círculo no puede salir. Elimínalo.");
          }
          const members = await tx.listCircleMembers(circle.id);
          if (!await tx.removeCircleMember(circle.id, address)) {
            // Removing someone twice succeeds. A stranger gets no hint that the circle exists.
            if (isOwner) return;
            throw notFound();
          }
          recordCircle(tx, o.userId, circle.id, "removed");
          await cancelForMembers(tx, members.map((member) => member.address));
        });
      },

      async removeFriend(o, friend) {
        if (!Address.safeParse(friend).success) throw new BrokerError("invalid_input", "La dirección no es válida.");
        await store.tx(async (tx) => {
          const me = (await tx.getUser(o.userId))?.address;
          const other = await tx.getUserByAddress(friend);
          const sides = [{ userId: o.userId, address: friend }];
          if (other && me) sides.push({ userId: other.userId, address: me });
          sides.sort((a, b) => a.userId.localeCompare(b.userId));
          let removed = false;
          for (const { userId, address } of sides) {
            removed = await tx.removeFriend(userId, address) || removed;
            await applySharing(tx, userId, address, noSharing);
            await cancelUnauthorized(tx, userId);
          }
          if (removed) record(tx, "broker.contact.removed", { userId: o.userId });
        });
      },

      async revokeAgent(o, agentId) {
        await store.tx((tx) => revokeConnection(tx, o.userId, agentId, clock.now()));
      },
    },

    admin: createAdminPort({ store, clock, telemetry }, { closePending, enqueue, record }),

    tick: createWorker({ store, waker, clock, telemetry, wakeRetryDelaysMs: config.wakeRetryDelaysMs }, closePending),
  };
}
