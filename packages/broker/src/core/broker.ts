import { randomUUID } from "node:crypto";
import {
  Address,
  AskInput,
  fieldsOf,
  describeTool,
  GrantInput,
  ToolName,
  LocalPart,
  OwnerDecision,
  ReplyInput,
  WakeTarget,
  WAKE_SUBSCRIPTION_SCOPE,
  type FinalOutcome,
  type Principal,
  type ReplyReceipt,
  type Scope,
  type ToolResult,
} from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import { filterResult } from "../policy/index.js";
import type { BrokerCore, BrokerDeps } from "../ports.js";
import type { RequestRow, StoreTx } from "../store/store.js";
import { createAdminPort, revokeConnection } from "./admin.js";
import { deriveNonce, hasNonce, signJson } from "./crypto.js";
import { approveOnce, escalate, parseResult, transition } from "./lifecycle.js";
import {
  toActivityItem, toAgentConnection, toGrant, toInboxItem, toOwnerPendingItem, toRequesterView,
} from "./views.js";
import { createWorker } from "./worker.js";

// A request stays authorized while the recipient's grant to the sender still covers its fields.
async function stillAuthorized(tx: StoreTx, row: RequestRow, toUserId: string): Promise<boolean> {
  // A connection test requested by the owner, or a request the owner approved once.
  if (row.fromUserId === null || row.approvedOnce) return true;
  const grant = await tx.getGrant(toUserId, row.fromAddress, row.tool);
  return grant !== null && row.allowedFields.every(field => grant.fields.includes(field));
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

function requireScope(principal: Principal, scope: Scope): void {
  if (!principal.scopes.includes(scope)) throw new BrokerError("forbidden", "El agente no tiene permiso para esta acción.");
}

export function createBroker(deps: BrokerDeps): BrokerCore {
  const { clock, config, nonceKey, signingKey, store, waker } = deps;
  const systemAddress = Address.parse(`system@${config.addressDomain}`);

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
    return true;
  }

  async function activeAgent(tx: StoreTx, principal: Principal) {
    const { userId, agentId } = principal;
    const connection = await tx.ensureAgentConnection({
      userId, agentId, label: agentId, wakeTarget: { kind: "none" }, createdAt: clock.now(),
    });
    if (connection.revokedAt) throw notFound();
    return connection;
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

  async function recordNew(tx: StoreTx, row: RequestRow, now: Date) {
    await tx.insertRequest(row);
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
      await tx.appendEvent({ requestId: row.id, at: now, kind: "delivery", status: "denied" });
    }
  }

  return {
    agent: {
      async capabilities(p, to) {
        requireScope(p, "nexo:ask");
        return store.tx(async tx => {
          await activeAgent(tx, p);
          const from = (await tx.getUser(p.userId))?.address;
          const owner = await tx.getUserByAddress(to);
          if (!from || !owner || from === to) return { tools: [] };
          const grants = await Promise.all(ToolName.options.map(tool => tx.getGrant(owner.userId, from, tool)));
          return { tools: grants.flatMap(grant => grant ? [describeTool(grant.tool, grant.fields)] : []) };
        });
      },

      async ask(p, input) {
        requireScope(p, "nexo:ask");
        const parsed = AskInput.safeParse(input);
        if (!parsed.success) throw new BrokerError("invalid_input", "La pregunta no cumple el formato de la herramienta.");
        const { to, tool, args, purpose } = parsed.data;
        const view = await store.tx(async (tx) => {
          await activeAgent(tx, p);
          const from = (await tx.getUser(p.userId))?.address;
          if (!from) return new BrokerError("invalid_input", "Primero elige tu dirección en la App Nexo.");
          if (from === to) return new BrokerError("invalid_input", "Elige una dirección distinta a la tuya.");
          const recipient = await tx.getUserByAddress(to);
          const now = clock.now();
          let row = await initialRequest({
            fromUserId: p.userId, fromAddress: from, toUserId: recipient?.userId ?? null, toAddress: to, tool, args, purpose,
          }, now);
          const grant = recipient && await tx.getGrant(recipient.userId, from, tool);
          if (grant) {
            const rule = `Permiso para ${tool}: ${grant.fields.join(", ")}`;
            row = { ...row, status: "awaiting_agent", allowedFields: grant.fields, rule };
          } else {
            const decisionReason = recipient ? "Sin permiso para esta herramienta." : "Dirección sin destinatario.";
            row = await finalize({ ...row, decisionReason }, "denied", now);
          }
          await recordNew(tx, row, now);
          return toRequesterView(row);
        });
        if (view instanceof BrokerError) throw view;
        return view;
      },

      async inbox(p) {
        requireScope(p, "nexo:inbox");
        return store.tx(async (tx) => {
          await activeAgent(tx, p);
          const address = (await tx.getUser(p.userId))?.address;
          if (!address) return [];
          const now = clock.now();
          return (await tx.listInbox(address))
            .filter((row) => row.toUserId === p.userId && (row.targetAgentId === undefined || row.targetAgentId === p.agentId) && row.expiresAt > now)
            .map((row) => toInboxItem(row, deriveNonce(nonceKey, row.id)));
        });
      },

      async reply(p, input) {
        requireScope(p, "nexo:reply");
        const result = await store.tx<ReplyReceipt | BrokerError>(async (tx) => {
          const connection = await activeAgent(tx, p);
          const row = await tx.getRequest(input.requestId, { toUserId: p.userId });
          if (!row || (row.targetAgentId !== undefined && row.targetAgentId !== p.agentId)) return notFound();

          const now = clock.now();
          async function reject(error: BrokerError): Promise<BrokerError> {
            await tx.appendEvent({ requestId: input.requestId, at: now, kind: "response", code: error.code });
            return error;
          }
          if (row.status !== "awaiting_agent") return reject(closed());
          if (row.expiresAt <= now) {
            const changed = await closePending(tx, row, "expired", now);
            return reject(changed ? expired() : closed());
          }
          if (!hasNonce(nonceKey, row.id, input.nonce)) {
            return reject(new BrokerError("forbidden", "El nonce no coincide."));
          }
          const parsed = ReplyInput.safeParse(input);
          if (!parsed.success) return reject(new BrokerError("invalid_input", "La respuesta no cumple el formato requerido."));

          const { outcome, internalReason } = parsed.data;
          let changed: RequestRow;
          let deliveredFields: string[] = [];
          let droppedFields: string[] = [];
          try {
            if (outcome === "needs_owner") {
              changed = await seal(escalate(row, deadline(now)));
            } else {
              let filtered: ToolResult | undefined;
              if (outcome === "answered") {
                const { result, delivered, dropped } = filterResult(row.tool, parsed.data.result, row.allowedFields);
                filtered = result;
                deliveredFields = delivered;
                droppedFields = dropped;
              }
              changed = await finalize(transition(row, outcome), outcome, now, filtered);
            }
          } catch (error) {
            if (error instanceof BrokerError) return reject(error);
            throw error;
          }
          const declaredFields = fieldsOf(row.tool);
          changed = {
            ...changed, internalReason, answeredByAgentId: p.agentId,
            droppedFields: droppedFields.filter((field) => declaredFields.includes(field)),
          };
          if (!await saveTransition(tx, row, changed)) return reject(closed());
          await tx.appendEvent({ requestId: row.id, at: now, kind: "response", status: changed.status });
          if (changed.closedAt) await tx.appendEvent({ requestId: row.id, at: now, kind: "delivery", status: changed.status });
          if (row.targetAgentId !== undefined) await tx.upsertAgentConnection({ ...connection, verifiedAt: now });
          return { requestId: row.id, status: changed.status, deliveredFields, droppedFields };
        });
        // Returning the error inside tx commits the expiry and any authorized audit event.
        if (result instanceof BrokerError) throw result;
        return result;
      },

      async status(p, id) {
        requireScope(p, "nexo:status");
        const view = await store.tx(async (tx) => {
          await activeAgent(tx, p);
          const row = await tx.getRequest(id, { fromUserId: p.userId });
          if (!row) return notFound();
          if (row.status === "answered" && row.answeredByAgentId && row.toUserId &&
              !await stillAuthorized(tx, row, row.toUserId)) {
            return toRequesterView(await finalize(row, "denied", clock.now()));
          }
          return toRequesterView(row);
        });
        if (view instanceof BrokerError) throw view;
        return view;
      },

      async connectWake(p, target) {
        // TODO(admin): registrar la decisión de permiso de suscripción con userId y agentId.
        requireScope(p, WAKE_SUBSCRIPTION_SCOPE);
        const parsed = WakeTarget.safeParse(target);
        if (!parsed.success) throw new BrokerError("invalid_input", "La configuración del aviso no es válida.");
        const wakeTarget = parsed.data;
        if (wakeTarget.kind === "mcp_events") {
          await store.tx((tx) => activeAgent(tx, p));
          const verification = await waker.verifyCallback(wakeTarget).catch(() => ({ ok: false as const, reason: "challenge_failed" as const }));
          if (!verification.ok) throw new BrokerError("invalid_input", verification.reason);
        }
        return store.tx(async (tx) => {
          const connection = await activeAgent(tx, p);
          const updated = { ...connection, wakeTarget };
          await tx.upsertAgentConnection(updated);
          return toAgentConnection(updated);
        });
      },

      async disconnectWake(p, subscriptionId) {
        // TODO(admin): registrar la decisión de permiso de cancelación con userId y agentId.
        requireScope(p, WAKE_SUBSCRIPTION_SCOPE);
        await store.tx(async (tx) => {
          const connection = await activeAgent(tx, p);
          if (connection.wakeTarget.kind !== "mcp_events" || connection.wakeTarget.subscriptionId !== subscriptionId) {
            throw notFound();
          }
          await tx.upsertAgentConnection({ ...connection, wakeTarget: { kind: "none" } });
        });
      },
    },

    owner: {
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
        // TODO(admin): emitir grant.set con userId cuando el broker tenga telemetría (ADM-07).
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
          // Narrowing an existing grant leaves pending requests that expect the old fields.
          await cancelUnauthorized(tx, o.userId);
          return toGrant(grant);
        });
      },

      async revokeGrant(o, grantId) {
        // TODO(admin): emitir grant.revoked con userId cuando el broker tenga telemetría (ADM-07).
        await store.tx(async (tx) => {
          if (!await tx.revokeGrant(grantId, o.userId, clock.now())) throw notFound();
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
          if (!address) throw new BrokerError("invalid_input", "Primero elige tu dirección en la App Nexo.");
          const now = clock.now();
          const row: RequestRow = {
            ...await initialRequest({
              fromAddress: systemAddress, toAddress: address, fromUserId: null, toUserId: o.userId,
              targetAgentId: agentId, tool: "question", args: { text: "Prueba de conexión de Nexo: responde con outcome no_data" },
            }, now),
            status: "awaiting_agent",
            rule: "Prueba de conexión solicitada por el dueño",
            allowedFields: fieldsOf("question"),
          };
          await recordNew(tx, row, now);
          return { requestId: row.id };
        });
      },

      async revokeAgent(o, agentId) {
        await store.tx((tx) => revokeConnection(tx, o.userId, agentId, clock.now()));
      },
    },

    admin: createAdminPort(deps, { closePending, enqueue }),

    tick: createWorker(deps, closePending),
  };
}
