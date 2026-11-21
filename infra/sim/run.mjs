#!/usr/bin/env node
// Arnés de punta a punta del flujo titular-a-titular de Sideband contra el stack vivo.
//
//   node infra/sim/run.mjs [N] [--brain=scripted|llm] [--model=<modelo>]
//
// Sin contenedores y sin dependencias: web (dev-login/dev-token), broker (/v1/owner/*) y el MCP
// remoto. Lo único que cambia entre los dos modos es quién redacta la respuesta de cada titular:
// el cerebro guionizado de brain.mjs o el CLI de agente de brain-llm.mjs. Escenario, carga,
// invariantes y resumen son los mismos.
//
// Los invariantes son propiedades del SISTEMA y viven aquí, fuera del cerebro: no se relajan
// porque haya un modelo en el bucle. Que uno se dispare con `--brain=llm` es el resultado más
// valioso que este arnés puede dar. Lo que afirma sobre un contenido concreto pertenece al modo
// guionizado; en modo llm el contenido es no determinista y solo se observa y se reporta.
import { loadEnv, createStack, sleep, HttpError } from "./lib.mjs";
import { scriptedBrain } from "./brain.mjs";
import { createLlmBrain } from "./brain-llm.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const ALL = ["availability", "interests", "health", "general"];
const FINAL_STATES = ["answered", "denied", "no_data", "declined", "expired", "delivery_failed"];
const DEADLINE_MS = 120_000;
// Identidades de prueba del arnés. Revocar una conexión de agente es irreversible, así que un
// juego de titulares quemado se abandona subiendo esta generación en vez de intentar repararlo.
const OWNER_PREFIX = "Sim3";

const flags = process.argv.slice(2);
const n = Number.parseInt(flags.find((flag) => !flag.startsWith("--")) ?? "3", 10);
const mode = (flags.find((flag) => flag.startsWith("--brain=")) ?? "").slice(8) || "scripted";
const model = (flags.find((flag) => flag.startsWith("--model=")) ?? "").slice(8) || undefined;
if (!Number.isInteger(n) || n < 2 || n > 12 || !["scripted", "llm"].includes(mode)) {
  console.error("Uso: node infra/sim/run.mjs [N] [--brain=scripted|llm] [--model=<modelo>]  (2 ≤ N ≤ 12)");
  process.exit(2);
}

const env = loadEnv(ROOT);
// Cada respuesta del modo llm cuesta una llamada al modelo, así que N chico por defecto.
const llm = mode === "llm" ? createLlmBrain({ apiKey: env.ANTHROPIC_API_KEY, ...(model ? { model } : {}) }) : undefined;
const brain = llm?.brain ?? scriptedBrain;

const runId = Math.random().toString(36).slice(2, 8);
const stack = createStack(env);
const violations = [];
const fail = (invariant, requestId, detail) => violations.push({ invariant, requestId, detail });

// ── Reglas del escenario ────────────────────────────────────────────────────────────────────────
// Lo que el titular `from` comparte con el titular `to`. La pareja (1 → 0) queda recortada a
// disponibilidad para que el arnés siempre ejercite una denegación de política, no solo `profile`.
const shareFor = (from, to) => (from === 1 && to === 0 ? ["availability"] : ALL);

const CATEGORY_OF = {
  interest_check: () => "interests",
  availability: () => "availability",
  question: (args) => args.category ?? "general",
  profile: () => undefined,
};
const FIELDS_OF = {
  interest_check: ["matches"], availability: ["available", "freeSlots"],
  question: ["answer"], profile: ["displayName", "headline"],
};

function factsFor(name, index) {
  return {
    interests: index % 2 === 0 ? ["cerámica", "trail"] : ["trail", "ajedrez"],
    busyDates: ["2026-12-02"],
    answers: {
      availability: `${name} tiene las tardes libres esta semana.`,
      interests: `${name} anda metido en ${index % 2 === 0 ? "cerámica" : "ajedrez"}.`,
      health: `${name} está bien, nada que reportar.`,
    },
  };
}

// ── Alta de titulares ───────────────────────────────────────────────────────────────────────────
async function setUpOwners() {
  const owners = [];
  for (let index = 0; index < n; index += 1) {
    const name = `${OWNER_PREFIX}${String(index + 1).padStart(2, "0")}`;
    await stack.web("/api/dev-login", { name });
    const token = await stack.web("/api/dev-token", { name });

    // dev-token reusa un único cliente OAuth por titular, así que `clientId` es estable y el
    // arnés siempre vuelve con el mismo `agentId`. Revocarlo es definitivo: ensureAgentConnection
    // inserta con onConflictDoNothing, nunca resucita una fila revocada, y entonces cada
    // `tools/call` muere en agent.connect con not_found —HTTP 403, "No se encontró el recurso
    // solicitado"— antes de ejecutar la tool. Por eso el arnés nunca revoca su propia conexión.
    const agents = await stack.owner(token.userId, "GET", "/v1/owner/agents");
    const mine = agents.items.find((agent) => agent.agentId === token.clientId);
    if (mine?.revokedAt) {
      throw new Error(
        `${name} tiene su conexión de agente revocada (${mine.revokedAt}) y el broker no la resucita. ` +
        "Cambia OWNER_PREFIX en infra/sim/run.mjs para usar identidades nuevas.",
      );
    }
    // Una conexión ajena viva sí bloquea: agent_connections_one_active admite una por titular.
    for (const agent of agents.items) {
      if (agent.agentId !== token.clientId && !agent.revokedAt) {
        await stack.owner(token.userId, "DELETE", `/v1/owner/agents/${agent.agentId}`);
      }
    }

    let me = await stack.owner(token.userId, "GET", "/v1/owner/me");
    if (!me.address) {
      me = { ...me, ...await stack.owner(token.userId, "POST", "/v1/owner/address", { localPart: `sim-${name.toLowerCase()}` }) };
    }
    owners.push({ index, name, userId: token.userId, accessToken: token.accessToken, address: me.address, facts: factsFor(name, index) });
  }
  return owners;
}

// ── Contactos con el reparto exacto que la carga va a ejercitar ─────────────────────────────────
async function connectOwners(owners) {
  for (const a of owners) {
    for (const b of owners) {
      if (a.index >= b.index) continue;
      const view = await stack.owner(a.userId, "GET", "/v1/owner/connections");
      const linked = view.contacts.some((contact) => contact.address === b.address);
      if (!linked) {
        const pending = view.outgoing.find((item) => item.address === b.address);
        if (!pending) await stack.owner(a.userId, "POST", "/v1/owner/connections", { to: b.address, share: shareFor(a.index, b.index) });
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const theirs = await stack.owner(b.userId, "GET", "/v1/owner/connections");
          const invitation = theirs.incoming.find((item) => item.address === a.address);
          if (invitation) {
            await stack.owner(b.userId, "POST", `/v1/owner/invitations/${invitation.requestId}`, { accept: true, share: shareFor(b.index, a.index) });
            break;
          }
          if (theirs.contacts.some((contact) => contact.address === a.address)) break;
          await sleep(250);
        }
      }
      // Repetir la corrida no debe heredar el reparto de la anterior.
      await stack.owner(a.userId, "PUT", `/v1/owner/connections/${b.address}/sharing`, shareFor(a.index, b.index));
      await stack.owner(b.userId, "PUT", `/v1/owner/connections/${a.address}/sharing`, shareFor(b.index, a.index));
    }
  }

  // El reparto declarado tiene que ser el que el broker guardó: si no, la carga mide otra cosa.
  for (const owner of owners) {
    const view = await stack.owner(owner.userId, "GET", "/v1/owner/connections");
    for (const other of owners) {
      if (other.index === owner.index) continue;
      const contact = view.contacts.find((item) => item.address === other.address);
      const expected = shareFor(owner.index, other.index);
      if (!contact) throw new Error(`${owner.name} no quedó conectado con ${other.name}.`);
      if ([...contact.gives].sort().join(",") !== [...expected].sort().join(",")) {
        throw new Error(`Reparto inesperado de ${owner.name} a ${other.name}: ${JSON.stringify(contact.gives)}`);
      }
    }
  }
}

// ── Carga ───────────────────────────────────────────────────────────────────────────────────────
function plannedAsks(asker, recipient) {
  return [
    { tool: "interest_check", args: { interest: `cerámica #${runId}` } },
    { tool: "availability", args: { date: "2026-12-03", start: "10:00", durationMinutes: 60, timezone: "America/Santiago" } },
    { tool: "question", args: { text: `¿Cómo has estado de salud? #${runId}`, category: "health" } },
    { tool: "question", args: { text: `¿Qué te tiene entretenido? #${runId}`, category: "general" } },
    { tool: "profile", args: {} },
  ].map((ask) => {
    const category = CATEGORY_OF[ask.tool](ask.args);
    const granted = category !== undefined && shareFor(recipient.index, asker.index).includes(category);
    return { ...ask, asker, recipient, category, granted };
  });
}

async function issueAsks(owners) {
  const requests = new Map();
  for (const asker of owners) {
    for (const recipient of owners) {
      if (asker.index === recipient.index) continue;
      for (const ask of plannedAsks(asker, recipient)) {
        const sent = await stack.callTool(asker.accessToken, "sideband_ask", { to: recipient.address, tool: ask.tool, args: ask.args });
        const { data: view, sentAt: startedAt } = sent;
        requests.set(view.requestId, { ...ask, requestId: view.requestId, startedAt, finalState: undefined, finishedAt: undefined, inboxItem: undefined, replies: 0, escalations: 0, result: undefined });
        observeView(requests.get(view.requestId), view);
      }
    }
  }
  return requests;
}

function stateOf(view) {
  if (view.final !== true) return undefined;
  if (view.decision === "deny") return "denied";
  if (view.decision === "allow") return view.outcome;
  return view.outcome;
}

function observeView(request, view) {
  const state = stateOf(view);
  if (state === undefined) return;
  if (request.finalState === undefined) {
    request.finalState = state;
    request.finishedAt = Date.now();
    request.result = view.result;
  } else if (request.finalState !== state) {
    // INV-1: una solicitud llega a un solo estado final.
    fail("INV-1 estado final único", request.requestId, `primero ${request.finalState}, después ${state}`);
  }
}

async function drive(owners, requests) {
  const seenInInbox = new Set();
  const byAddress = new Map(owners.map((owner) => [owner.address, owner]));
  const started = Date.now();

  while (Date.now() - started < DEADLINE_MS) {
    const open = [...requests.values()].filter((request) => request.finalState === undefined);
    if (open.length === 0) break;

    for (const owner of owners) {
      const { items } = (await stack.callTool(owner.accessToken, "sideband_inbox", {})).data;
      for (const item of items) {
        seenInInbox.add(item.requestId);
        const request = requests.get(item.requestId);
        if (!request) continue;
        request.inboxItem = item;
        checkInboxItem(request, item, owner);

        const context = {
          owner: { name: owner.name, address: owner.address, userId: owner.userId },
          from: item.from, shares: shareFor(owner.index, byAddress.get(item.from)?.index ?? -1),
          category: item.ownerAuthorization.category, facts: owner.facts, runId,
        };
        const send = (payload) => stack.callTool(
          owner.accessToken, "sideband_reply", { requestId: item.requestId, nonce: item.nonce, ...payload }, { allowError: true },
        );
        // Un result malformado se rechaza en dos capas distintas y hay que reconocer las dos:
        // el esquema de la tool en el MCP (error de protocolo, texto suelto) y `invalid_input`
        // del broker (sobre `{ ok: false, error }`). Tratar la primera como éxito fue un defecto
        // real de este arnés: lo encontró INV-5 en la primera corrida con modelo.
        const rejectionOf = (response) => {
          if (response.data?.ok === false) return response.data.error?.code ?? "desconocido";
          if (response.isError) return "schema_mcp";
          return undefined;
        };

        let reply = await brain(item, context);
        let response = await send(reply);
        let rejection = rejectionOf(response);

        // Que el esquema rechace lo que redactó el cerebro es una falla del cerebro, no del
        // sistema: en modo llm se anota y se cierra con una respuesta válida, porque una solicitud
        // colgada dispararía INV-5 y taparía el hallazgo real. El cerebro guionizado no puede
        // producirlo, así que ahí sí es un defecto y se reporta como violación.
        if (rejection === "invalid_input" || rejection === "schema_mcp") {
          if (!llm) fail("INV-2 respuesta rechazada", item.requestId, JSON.stringify(response.data));
          else llm.stats.observations.push({
            kind: rejection === "schema_mcp" ? "el esquema de la tool rechazó su result" : "el broker rechazó su result",
            requestId: item.requestId, tool: item.tool, detail: JSON.stringify(reply.result ?? null),
          });
          reply = { outcome: "no_data" };
          response = await send(reply);
          rejection = rejectionOf(response);
        }
        if (rejection !== undefined) {
          if (rejection !== "conflict") fail("INV-2 respuesta rechazada", item.requestId, JSON.stringify(response.data));
          continue;
        }
        request.replies += 1;
        request.receipt = response.data;

        // INV-2: una segunda respuesta a la misma solicitud se rechaza con `conflict`.
        const second = await send(reply);
        if (rejectionOf(second) !== "conflict") {
          fail("INV-2 segunda respuesta aceptada", item.requestId, JSON.stringify(second.data));
        }
      }
    }

    // Lo escalado al titular se decide aquí: sin esto, `needs_owner` dejaría solicitudes abiertas.
    for (const owner of owners) {
      const { items } = await stack.owner(owner.userId, "GET", "/v1/owner/pending");
      for (const item of items) {
        const request = requests.get(item.requestId);
        if (!request) continue;
        request.escalations += 1;
        const kind = request.escalations > 1 ? "deny" : "approve_once";
        await stack.owner(owner.userId, "POST", `/v1/owner/requests/${item.requestId}/decision`, { kind });
      }
    }

    for (const request of open) {
      const view = (await stack.callTool(request.asker.accessToken, "sideband_check", { requestId: request.requestId })).data;
      observeView(request, view);
    }
    await sleep(250);
  }
  return seenInInbox;
}

function checkInboxItem(request, item, owner) {
  // INV-3: una denegación de política nunca despierta al destinatario.
  if (!request.granted) {
    fail("INV-3 denegada en bandeja", request.requestId, `${request.asker.name}→${owner.name} ${request.tool}/${request.category ?? "sin categoría"} apareció en la bandeja de ${owner.name}`);
  }
  if (request.category !== undefined && item.ownerAuthorization.category !== request.category) {
    fail("INV-4 categoría distinta", request.requestId, `pedida ${request.category}, autorizada ${item.ownerAuthorization.category}`);
  }
  const extra = item.allowedFields.filter((field) => !FIELDS_OF[request.tool].includes(field));
  if (extra.length > 0) fail("INV-4 campos fuera de la tool", request.requestId, `allowedFields ${JSON.stringify(item.allowedFields)}`);
}

function checkFinal(requests, seenInInbox) {
  for (const request of requests.values()) {
    const label = `${request.asker.name}→${request.recipient.name} ${request.tool}/${request.category ?? "sin categoría"}`;

    // INV-5: ninguna solicitud se pierde en silencio.
    if (request.finalState === undefined) {
      fail("INV-5 sin estado final", request.requestId, `${label} sigue abierta tras ${DEADLINE_MS / 1000}s`);
      continue;
    }
    if (!FINAL_STATES.includes(request.finalState)) {
      fail("INV-5 estado final desconocido", request.requestId, `${label} terminó en ${request.finalState}`);
    }

    // INV-4: nadie ve un campo fuera de la categoría que le concedieron.
    if (!request.granted && request.finalState !== "denied") {
      fail("INV-4 sin permiso pero no denegada", request.requestId, `${label} terminó en ${request.finalState}`);
    }
    if (!request.granted && seenInInbox.has(request.requestId)) {
      fail("INV-3 denegada en bandeja", request.requestId, label);
    }
    if (request.finalState === "answered") {
      if (!request.granted) fail("INV-4 respuesta sin permiso", request.requestId, label);
      const allowed = request.inboxItem?.allowedFields ?? FIELDS_OF[request.tool];
      const leaked = Object.keys(request.result ?? {}).filter((field) => !allowed.includes(field));
      if (leaked.length > 0) fail("INV-4 campo entregado fuera de lo permitido", request.requestId, `${label} entregó ${JSON.stringify(leaked)}`);
    }
  }
}

// ── Resumen ─────────────────────────────────────────────────────────────────────────────────────
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarise(requests, elapsed) {
  const counts = {};
  const reported = {};
  const latencies = [];
  for (const request of requests.values()) {
    const state = request.finalState ?? "sin_estado_final";
    counts[state] = (counts[state] ?? 0) + 1;
    // El destinatario distingue `declined` de `denied`; quien pregunta no, y así debe ser.
    const status = request.receipt?.status ?? "sin respuesta del destinatario";
    reported[status] = (reported[status] ?? 0) + 1;
    if (request.finishedAt) latencies.push(request.finishedAt - request.startedAt);
  }
  console.log(`\n── Resumen · ${n} titulares · ${requests.size} solicitudes · cerebro ${mode} · corrida ${runId} · ${(elapsed / 1000).toFixed(1)}s`);
  console.log("Estados finales:");
  for (const [state, count] of Object.entries(counts).sort()) console.log(`  ${state.padEnd(18)} ${count}`);
  console.log("Cierre informado por el destinatario:");
  for (const [status, count] of Object.entries(reported).sort()) console.log(`  ${status.padEnd(28)} ${count}`);
  console.log("Latencia ask→final (ms):");
  console.log(`  p50 ${percentile(latencies, 50)}  p90 ${percentile(latencies, 90)}  p95 ${percentile(latencies, 95)}  p99 ${percentile(latencies, 99)}  max ${Math.max(0, ...latencies)}`);
  if (llm) summariseModels(requests, elapsed);
}

// Lo que el cerebro guionizado no puede mostrar: qué hizo realmente el modelo. Nada de esto falla
// la corrida —no son invariantes— pero es la razón de ser de este modo, así que se imprime entero.
function summariseModels(requests, elapsed) {
  const { model, calls, failures, wallMs, costUsd, observations } = llm.stats;
  console.log(`\n── Qué hicieron los modelos · ${model}`);
  console.log(`  ${calls} llamadas, ${failures} sin respuesta utilizable · ${(wallMs / 1000).toFixed(1)}s de ${(elapsed / 1000).toFixed(1)}s (${Math.round((wallMs / elapsed) * 100)}% del reloj) · USD ${costUsd.toFixed(4)}`);

  // El broker recorta lo que el agente no debía entregar: cada campo descartado es un intento.
  const dropped = [...requests.values()].filter((request) => (request.receipt?.droppedFields ?? []).length > 0);
  for (const request of dropped) {
    observations.push({ kind: "el broker le recortó campos al entregar", requestId: request.requestId, tool: request.tool, detail: JSON.stringify(request.receipt.droppedFields) });
  }

  if (observations.length === 0) {
    console.log("  Sin desvíos observados.");
    return;
  }
  const byKind = new Map();
  for (const observation of observations) {
    if (!byKind.has(observation.kind)) byKind.set(observation.kind, []);
    byKind.get(observation.kind).push(observation);
  }
  console.log(`  Desvíos observados: ${observations.length}`);
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  · ${kind} (${list.length})`);
    for (const observation of list.slice(0, 3)) {
      console.log(`      ${observation.requestId.slice(0, 8)} ${observation.tool}${observation.detail ? `: ${String(observation.detail).replace(/\s+/g, " ").slice(0, 110)}` : ""}`);
    }
    if (list.length > 3) console.log(`      … y ${list.length - 3} más`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const started = Date.now();
  console.log(`Stack: web ${stack.webUrl} · broker ${stack.brokerUrl} · mcp ${stack.mcpUrl}`);
  const owners = await setUpOwners();
  console.log(`Titulares: ${owners.map((owner) => `${owner.name} <${owner.address}>`).join(", ")}`);
  await connectOwners(owners);
  console.log("Contactos listos con el reparto del escenario.");
  const requests = await issueAsks(owners);
  console.log(`Enviadas ${requests.size} solicitudes.`);
  const seenInInbox = await drive(owners, requests);
  checkFinal(requests, seenInInbox);
  summarise(requests, Date.now() - started);

  if (violations.length === 0) {
    console.log("\nInvariantes: todas se mantienen.");
    return;
  }
  console.log(`\nInvariantes violadas: ${violations.length}`);
  for (const violation of violations) console.log(`  [${violation.invariant}] ${violation.requestId}: ${violation.detail}`);
  process.exitCode = 1;
}

main().catch((error) => {
  if (error instanceof HttpError) {
    console.error(`\nFalló ${error.where} (HTTP ${error.status}).`);
    console.error("Petición:", JSON.stringify(error.request));
    console.error("Respuesta:", typeof error.body === "string" ? error.body : JSON.stringify(error.body));
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
