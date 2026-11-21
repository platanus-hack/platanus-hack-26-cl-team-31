#!/usr/bin/env node
// Runner de carga + correctitud: siembra un mundo determinista, lanza N agentes virtuales contra la
// API de coordinación, verifica invariantes en cada respuesta y en la base final, e informa métricas.
// En Docker: pnpm scale:run <escenario> [--agents N] ...  (ver AGENTS.md)
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Invariants, checkDatabase } from "./invariants.mjs";
import { Metrics, latency, table } from "./metrics.mjs";
import { rng, unit } from "./prng.mjs";
import { applySchema, seedWorld, writeTokens } from "./seed.mjs";
import { errorShape, shapes } from "./shapes.mjs";
import { httpTransport, mcpSession } from "./transport.mjs";
import { generateWorld, listScenarios, loadScenario } from "./world.mjs";

const MINUTE = 60_000;
const USAGE = `Uso: run.mjs <escenario> [--agents N] [--iterations N] [--duration SEG] [--concurrency N]
       [--seed S] [--mcp [K]] [--reset] [--results DIR] [--api URL]
Escenarios: ${listScenarios().join(", ")}`;

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, any> & {_: string[]}} */
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = /** @type {string} */ (argv[i]);
    if (!arg.startsWith("--")) { out._.push(arg); continue; }
    const [key, inline] = /** @type {[string, string | undefined]} */ (arg.slice(2).split("=", 2));
    const next = argv[i + 1];
    if (inline !== undefined) out[key] = inline;
    else if (key === "reset" || key === "help") out[key] = true;
    else if (key === "mcp") out[key] = next && /^\d+$/.test(next) ? argv[++i] : "all";
    else if (next !== undefined && !next.startsWith("--")) out[key] = argv[++i];
    else throw new Error(`Falta valor para --${key}\n${USAGE}`);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help || !opts._[0]) { console.log(USAGE); process.exit(opts.help ? 0 : 2); }
const num = (/** @type {any} */ v) => (v === undefined ? undefined : Number(v));
const sc = loadScenario(/** @type {string} */ (opts._[0]), {
  ...(opts.agents && { agents: num(opts.agents) }),
  ...(opts.seed && { seed: opts.seed }),
  run: {
    ...(opts.iterations && { iterations: num(opts.iterations), durationSec: 0 }),
    ...(opts.duration && { durationSec: num(opts.duration) }),
    ...(opts.concurrency && { concurrency: num(opts.concurrency) }),
  },
});
const api = opts.api ?? process.env.COORDINATION_API_URL;
if (!api || !process.env.DATABASE_URL) throw new Error("Se requieren COORDINATION_API_URL y DATABASE_URL (usa Docker o pnpm with-env).");
const resultsDir = opts.results ?? process.env.SCALE_RESULTS_DIR ?? fileURLToPath(new URL("../../../.scale-results/", import.meta.url));
const runId = process.env.SCALE_RUN_ID || `${sc.name}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

const world = generateWorld(sc);
const concurrency = Math.max(1, Math.min(sc.run.concurrency || world.people.length, world.people.length));
const inv = new Invariants();
const metrics = new Metrics();
const transport = httpTransport(api, concurrency + 16);
/** @type {Record<string, number>} */ const phases = {};
const log = (/** @type {string} */ msg) => console.log(`[scale] ${msg}`);
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

/** @template T @param {string} label @param {() => Promise<T>} fn @returns {Promise<T>} */
async function phase(label, fn) {
  const started = performance.now();
  const result = await fn();
  phases[label] = Math.round(performance.now() - started);
  log(`${label}: ${phases[label]} ms`);
  return result;
}

/** @template T @param {T[]} items @param {number} limit @param {(item: T) => Promise<void>} fn */
async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(/** @type {T} */ (items[next++]));
  }));
}

log(`escenario ${sc.name} · seed ${sc.seed} · mundo ${world.hash}: ${world.agents.length} agentes + ` +
  `${world.outsiders.length} externos, ${world.groups.length} grupos, ${world.memberships.length} membresías, ` +
  `${world.busy.length} bloques privados, ${world.interests.length} intereses · concurrencia ${concurrency}`);

// --- Siembra ---------------------------------------------------------------------------------
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const tokens = await phase("seed", async () => {
  await applySchema(db);
  return seedWorld(db, world, { reset: Boolean(opts.reset) });
});
log(`tokens en ${await writeTokens(tokens)}`);

for (let i = 0; ; i++) {
  const health = await transport.call({ path: "/health" });
  if (health.status === 200) break;
  if (i > 60) throw new Error(`La API no responde en ${api}`);
  await sleep(500);
}

/**
 * @typedef {{id: string, token: string, groups: string[], r: ReturnType<typeof rng>, seq: number,
 *   requests: {id: string, status: string, volatile: boolean}[], listings: {interest: string, group: string}[],
 *   mcp: Awaited<ReturnType<typeof mcpSession>> | null}} Agent
 * @typedef {{id: string, organizer: string, group: string, participants: string[], slots: number[], minutes: number,
 *   expected: {status: string, slot?: number}}} Proposal
 */
/** @type {Agent[]} */
const agents = world.people.map(id => ({
  id, token: /** @type {string} */ (tokens.get(id)), groups: world.groupsOf.get(id) ?? [],
  r: rng(`agent|${sc.seed}|${id}`), seq: 0, requests: [], listings: [], mcp: null,
}));
const byId = new Map(agents.map(a => [a.id, a]));

if (opts.mcp) {
  const k = opts.mcp === "all" ? world.agents.length : Math.min(Number(opts.mcp), world.agents.length);
  await phase(`mcp_connect(${k})`, () => pool(agents.slice(0, k), 16, async a => {
    a.mcp = await mcpSession(api, a.token, a.id);
  }));
}

// --- Llamadas e invariantes por respuesta ----------------------------------------------------
/**
 * @param {Agent} a @param {string} tool @param {unknown} args
 * @param {{expect?: number, metric?: string, token?: string, raw?: string, path?: string, http?: boolean}} [o]
 */
async function call(a, tool, args, o = {}) {
  const reqId = `${a.id}#${++a.seq}`;
  const viaMcp = Boolean(a.mcp && !o.http && !o.token && o.raw === undefined && !o.path);
  const res = viaMcp && a.mcp
    ? await a.mcp.call(tool, args)
    : await transport.call({ path: o.path ?? `/tools/${tool}`, token: o.token ?? a.token,
      body: o.raw === undefined ? args : undefined, raw: o.raw, reqId });
  const expect = o.expect ?? 200;
  metrics.record(o.metric ?? (viaMcp ? `mcp.${tool}` : tool), res, res.status !== expect);
  const snippet = res.text.slice(0, 200);
  inv.check("no_network_errors", res.status !== 0, reqId, { tool, error: res.error });
  inv.check("no_5xx", res.status < 500, reqId, { tool, status: res.status, body: snippet });
  inv.check("no_private_titles_in_responses", !res.text.includes(world.marker), reqId, { tool });
  /** @type {any} */ let ok = null;
  if (res.status !== 0 && res.status < 500
    && inv.check("expected_http_status", res.status === expect, reqId, { tool, expect, got: res.status, body: snippet })) {
    if (res.status === 200) {
      const why = shapes[tool]?.(res.body) ?? null;
      if (inv.check("response_shape", why === null, reqId, { tool, why, body: snippet })) ok = res.body;
    } else if (!viaMcp) {
      inv.check("error_shape", errorShape(res.body) === null, reqId, { tool, body: snippet });
    }
  }
  return { ...res, reqId, ok };
}

/** Respuestas de denegación idénticas: no revelan si la otra parte existe ni por qué se negó. */
/** @param {string} name @param {Awaited<ReturnType<typeof call>>} x @param {Awaited<ReturnType<typeof call>>} y */
function indistinguishable(name, x, y) {
  inv.check(name, x.status === y.status && x.text === y.text && x.ok?.status === "not_shareable",
    x.reqId, { a: x.text.slice(0, 120), b: y.text.slice(0, 120), other: y.reqId });
}

const think = (/** @type {Agent} */ a) => a.r.range(sc.run.thinkMs);
function randomInterval(/** @type {Agent} */ a) {
  const half = world.slotMinutes / 2;
  return {
    slot: a.r.pick(world.grid) + (a.r.chance(0.3) ? half * MINUTE : 0),
    minutes: a.r.pick([half, world.slotMinutes, 2 * world.slotMinutes]),
  };
}
function target(/** @type {Agent} */ a) {
  if (!a.groups.length || a.r.chance(sc.foreign)) return { group: a.r.pick(world.groups), recipient: a.r.pick(world.people) };
  const group = a.r.pick(a.groups);
  return { group, recipient: a.r.pick(/** @type {string[]} */ (world.membersOf.get(group))) };
}
function audience(/** @type {Agent} */ a) {
  if (a.r.chance(sc.interests.public)) return "";
  return !a.groups.length || a.r.chance(sc.foreign) ? a.r.pick(world.groups) : a.r.pick(a.groups);
}
/** Variantes de escritura que el servidor debe normalizar (mayúsculas, NFD). @param {Agent} a @param {string} word */
function variant(a, word) {
  const x = a.r.next();
  return x < 0.15 ? word.toUpperCase() : x < 0.3 ? word.normalize("NFD") : word;
}
const listing = (/** @type {string} */ interest, /** @type {string} */ group) => (group ? { interest, group } : { interest });

// --- Estado compartido de encuentros ---------------------------------------------------------
/** @type {Map<string, Proposal>} */ const proposals = new Map();
/** @type {Proposal[]} */ const proposalList = [];
/** @type {Map<string, string[]>} */ const meetingsOf = new Map();
/** @type {Map<string, {statuses: Set<string>, slots: Set<number>, reqIds: string[]}>} */ const observed = new Map();
/** @type {{owner: string, id: string}[]} */ const requestIds = [];
const timing = { outsider: /** @type {number[]} */ ([]), ghost: /** @type {number[]} */ ([]) };

const accepts = (/** @type {string} */ id, /** @type {string} */ person) => unit(sc.seed, id, person) < sc.meetings.accept;
const volatileIn = (/** @type {Proposal} */ p) =>
  p.participants.some(x => x !== p.organizer && world.member(x, p.group)?.volatile);

/** Resultado esperado: primera opción (en orden del organizador) libre para todos; luego decisiones. */
function expectedOutcome(/** @type {Omit<Proposal, "expected">} */ p) {
  const slot = p.slots.find(s => p.participants.every(x => world.isFree(x, s, p.minutes)));
  if (slot === undefined) return { status: "no_shared_slot" };
  return { status: p.participants.every(x => accepts(p.id, x)) ? "confirmed" : "declined", slot };
}

/** @param {any} view @param {string} reqId */
function observe(view, reqId) {
  if (!view || view.status === "not_shareable") return;
  let o = observed.get(view.id);
  if (!o) observed.set(view.id, o = { statuses: new Set(), slots: new Set(), reqIds: [] });
  o.statuses.add(view.status);
  if (view.slot) o.slots.add(Date.parse(view.slot));
  if (o.reqIds.length < 5) o.reqIds.push(reqId);
}

// --- Acciones de un agente -------------------------------------------------------------------
/** @param {Agent} a */
async function availabilityCheck(a) {
  const { group, recipient } = target(a);
  const { slot, minutes } = randomInterval(a);
  const res = await call(a, "availability_check", { recipient, group, slot: iso(slot), minutes });
  if (!res.ok) return;
  const allowed = world.allowed(a.id, recipient, group);
  if (allowed !== null) {
    const want = allowed ? (world.isFree(recipient, slot, minutes) ? "available" : "busy") : "not_shareable";
    inv.check("availability_matches_oracle", res.ok.status === want, res.reqId, { recipient, group, want, got: res.ok.status });
  }
  if (res.ok.request_id) {
    a.requests.push({ id: res.ok.request_id, status: res.ok.status, volatile: allowed === null });
    if (requestIds.length < 5000) requestIds.push({ owner: a.id, id: res.ok.request_id });
  }
}

/** @param {Agent} a */
async function requestGet(a) {
  if (!a.requests.length) return availabilityCheck(a);
  const q = a.r.pick(a.requests);
  const res = await call(a, "request_get", { request_id: q.id });
  if (res.ok && !q.volatile) {
    inv.check("request_get_matches_original", res.ok.status === q.status && res.ok.request_id === q.id, res.reqId, { q, got: res.ok });
  }
}

/** @param {Agent} a */
async function interestPublish(a) {
  const interest = a.r.pick(world.vocabulary);
  const group = audience(a);
  const res = await call(a, "interest_publish", listing(variant(a, interest), group));
  if (!res.ok) return;
  const want = !group || world.member(a.id, group) ? "published" : "not_shareable";
  inv.check("interest_publish_matches_oracle", res.ok.status === want, res.reqId, { group, want, got: res.ok.status });
  // Sólo se retiran publicaciones propias de la corrida: las sembradas deben seguir visibles.
  const seeded = world.listings.get(`${interest}|${group}`)?.has(a.id);
  if (res.ok.status === "published" && !seeded && !a.listings.some(l => l.interest === interest && l.group === group)) {
    a.listings.push({ interest, group });
  }
}

/** @param {Agent} a */
async function interestWithdraw(a) {
  if (!a.listings.length) return interestPublish(a);
  const [l] = a.listings.splice(a.r.int(0, a.listings.length - 1), 1);
  if (l) await call(a, "interest_withdraw", listing(variant(a, l.interest), l.group));
}

/** @param {Agent} a */
async function interestSearch(a) {
  let interest, group;
  if (world.interests.length && a.r.chance(0.5)) {
    const seeded = a.r.pick(world.interests);
    interest = seeded.interest;
    group = a.r.chance(0.7) ? seeded.audience : audience(a);
  } else {
    interest = a.r.pick(world.vocabulary);
    group = audience(a);
  }
  const res = await call(a, "interest_search", listing(variant(a, interest), group));
  if (!res.ok) return;
  /** @type {string[]} */ const persons = res.ok.entries.map((/** @type {any} */ e) => e.person);
  inv.check("interest_search_topic_normalized", res.ok.entries.every((/** @type {any} */ e) => e.interest === interest), res.reqId, { interest });
  inv.check("interest_search_sorted", persons.every((p, i) => i === 0 || /** @type {string} */ (persons[i - 1]) < p), res.reqId, { persons });
  if (group && !world.member(a.id, group)) {
    inv.check("interest_search_hidden_from_outsiders", persons.length === 0, res.reqId, { group, persons: persons.slice(0, 5) });
    return;
  }
  if (group) {
    inv.check("interest_search_only_members", persons.every(p => world.member(p, group)), res.reqId,
      { group, intruders: persons.filter(p => !world.member(p, group)) });
  }
  const found = new Set(persons);
  const missing = [...(world.listings.get(`${interest}|${group}`) ?? [])].filter(p => !found.has(p));
  inv.check("interest_search_complete", missing.length === 0, res.reqId, { interest, group, missing: missing.slice(0, 5) });
}

/** @param {Agent} a */
async function meetingPropose(a) {
  const askGroups = a.groups.filter(g => world.member(a.id, g)?.canAsk);
  const k = Math.max(1, a.r.range(sc.meetings.participants) - 1);
  let group, recipients;
  if (!askGroups.length || a.r.chance(sc.foreign / 2)) {
    group = a.r.pick(world.groups);
    recipients = a.r.sample(world.people, k + 1).filter(p => p !== a.id).slice(0, k);
  } else {
    group = a.r.pick(askGroups);
    const candidates = /** @type {string[]} */ (world.membersOf.get(group))
      .filter(p => p !== a.id && world.member(p, group)?.canShare);
    recipients = a.r.sample(candidates, k);
  }
  if (!recipients.length) return meetingInbox(a);
  const slots = a.r.sample(world.grid, a.r.range(sc.meetings.slots));
  const minutes = world.slotMinutes;
  const res = await call(a, "meeting_propose", { recipients, slots: slots.map(iso), minutes, group });
  if (!res.ok) return;
  const perms = recipients.map(p => world.allowed(a.id, p, group));
  const allowed = perms.every(x => x === true) ? true : perms.includes(false) ? false : null;
  if (allowed === false) inv.check("meeting_propose_denied_without_permission", res.ok.status === "not_shareable", res.reqId, { group, recipients });
  if (allowed === true) inv.check("meeting_propose_allowed_with_permission", res.ok.status === "collecting", res.reqId, { group, got: res.ok.status });
  if (res.ok.status === "not_shareable") return;
  const participants = [...new Set([a.id, ...recipients])].sort();
  inv.check("meeting_propose_echo", res.ok.organizer === a.id && res.ok.participants.join() === participants.join()
    && res.ok.minutes === minutes && res.ok.slots.map(Date.parse).join() === slots.join(), res.reqId, res.ok);
  const base = { id: res.ok.id, organizer: a.id, group, participants, slots, minutes };
  const proposal = { ...base, expected: expectedOutcome(base) };
  proposals.set(proposal.id, proposal);
  proposalList.push(proposal);
  for (const x of participants) meetingsOf.set(x, [...(meetingsOf.get(x) ?? []), proposal.id]);
  observe(res.ok, res.reqId);
}

/** Procesa la bandeja: responde con el calendario o decide. Devuelve cuántos ítems había. @param {Agent} a */
async function meetingInbox(a) {
  const res = await call(a, "meeting_inbox", {});
  if (!res.ok) return 0;
  for (const m of res.ok.meetings) {
    observe(m, res.reqId);
    inv.check("inbox_only_own_meetings", m.participants.includes(a.id), res.reqId, { id: m.id });
    inv.check("inbox_only_pending", m.status === "collecting" || m.status === "proposed", res.reqId, { id: m.id, status: m.status });
    const proposal = proposals.get(m.id);
    if (m.status === "collecting") {
      const r = await call(a, "meeting_respond", { id: m.id });
      if (!r.ok) continue;
      observe(r.ok, r.reqId);
      if (proposal && !volatileIn(proposal)) inv.check("meeting_respond_permitted", r.ok.status !== "not_shareable", r.reqId, { id: m.id });
    } else if (m.status === "proposed") {
      const accept = accepts(m.id, a.id);
      const r = await call(a, "meeting_decide", { id: m.id, accept });
      if (!r.ok) continue;
      observe(r.ok, r.reqId);
      if (r.ok.status !== "not_shareable") {
        inv.check("meeting_decide_outcome", accept ? r.ok.status !== "collecting" && r.ok.status !== "no_shared_slot"
          : r.ok.status === "declined", r.reqId, { id: m.id, accept, got: r.ok.status });
      }
    }
  }
  return res.ok.meetings.length;
}

/** @param {Agent} a */
async function meetingGet(a) {
  const ids = meetingsOf.get(a.id);
  if (!ids?.length) return meetingInbox(a);
  const id = a.r.pick(ids);
  const res = await call(a, "meeting_get", { id });
  if (!res.ok) return;
  observe(res.ok, res.reqId);
  const p = proposals.get(id);
  if (p && !volatileIn(p)) inv.check("meeting_get_participant_access", res.ok.status !== "not_shareable", res.reqId, { id });
}

/** Revoca y restaura can_share en una membresía "volátil" (o intenta cambiar un grupo ajeno). @param {Agent} a */
async function groupPermission(a) {
  const volatile = a.groups.map(g => world.member(a.id, g)).filter(m => m?.volatile);
  if (!volatile.length) {
    const group = a.r.pick(world.groups);
    if (world.member(a.id, group)) return meetingInbox(a);
    const res = await call(a, "group_permission", { group, can_share: true });
    if (res.ok) inv.check("group_permission_requires_membership", res.ok.status === "not_shareable", res.reqId, res.ok);
    return;
  }
  const m = /** @type {NonNullable<typeof volatile[number]>} */ (a.r.pick(volatile));
  for (const canShare of [!m.canShare, m.canShare]) {
    const res = await call(a, "group_permission", { group: m.group, can_share: canShare });
    if (res.ok) {
      inv.check("group_permission_applied", res.ok.status === "updated" && res.ok.can_ask === m.canAsk
        && res.ok.can_share === canShare, res.reqId, res.ok);
    }
    if (canShare !== m.canShare) await sleep(think(a));
  }
}

/** Sondas de seguridad: denegaciones indistinguibles y entradas fuera de contrato. @param {Agent} a */
async function probe(a) {
  const group = a.groups.length ? a.r.pick(a.groups) : a.r.pick(world.groups);
  const ghost = a.r.pick(world.ghosts);
  switch (a.r.int(0, 7)) {
    case 0: { // externo o miembro que no comparte vs. persona inexistente
      const hidden = (world.membersOf.get(group) ?? []).filter(p => world.allowed(a.id, p, group) === false);
      const pool = [...world.outsiders, ...hidden];
      if (!pool.length) return;
      const { slot, minutes } = randomInterval(a);
      const base = { group, slot: iso(slot), minutes };
      const x = await call(a, "availability_check", { ...base, recipient: a.r.pick(pool) }, { metric: "probe.check_hidden" });
      const y = await call(a, "availability_check", { ...base, recipient: ghost }, { metric: "probe.check_ghost" });
      indistinguishable("hidden_vs_nonexistent_check", x, y);
      timing.outsider.push(x.ms); timing.ghost.push(y.ms);
      return;
    }
    case 1: { // proponer a un externo vs. a alguien inexistente
      if (!world.outsiders.length) return;
      const base = { slots: [iso(a.r.pick(world.grid))], minutes: world.slotMinutes, group };
      const x = await call(a, "meeting_propose", { ...base, recipients: [a.r.pick(world.outsiders)] }, { metric: "probe.propose_outsider" });
      const y = await call(a, "meeting_propose", { ...base, recipients: [ghost] }, { metric: "probe.propose_ghost" });
      indistinguishable("outsider_vs_nonexistent_propose", x, y);
      return;
    }
    case 2: { // respuesta guardada de otro agente vs. uuid inventado
      const foreign = requestIds.filter(q => q.owner !== a.id);
      if (!foreign.length) return;
      const x = await call(a, "request_get", { request_id: a.r.pick(foreign).id }, { metric: "probe.request_foreign" });
      const y = await call(a, "request_get", { request_id: randomUUID() }, { metric: "probe.request_random" });
      indistinguishable("foreign_vs_random_request", x, y);
      return;
    }
    case 3: { // encuentro ajeno vs. uuid inventado (lectura y respuesta)
      const foreign = a.r.sample(proposalList, 8).find(p => !p.participants.includes(a.id));
      if (!foreign) return;
      for (const tool of ["meeting_get", "meeting_respond"]) {
        const x = await call(a, tool, { id: foreign.id }, { metric: `probe.${tool}_foreign` });
        const y = await call(a, tool, { id: randomUUID() }, { metric: `probe.${tool}_random` });
        indistinguishable("foreign_vs_random_meeting", x, y);
      }
      return;
    }
    case 4: { // credencial inventada
      const res = await call(a, "availability_check", { ...target(a), slot: iso(world.grid[0] ?? 0), minutes: 30 },
        { token: `fake-${randomUUID()}`, expect: 401, metric: "probe.bad_token" });
      inv.check("bad_token_rejected", res.text === '{"error":"unauthorized"}', res.reqId, res.text);
      return;
    }
    case 5: { // suplantación vía campo extra (también por MCP si el agente lo usa)
      const victim = a.r.pick(world.agents);
      await call(a, "availability_check", { ...target(a), slot: iso(world.grid[0] ?? 0), minutes: 30, actor: victim },
        { expect: 400, metric: a.mcp ? "probe.mcp_extra_field" : "probe.extra_field" });
      return;
    }
    case 6:
      await call(a, "no_such_tool", {}, { path: "/tools/no_such_tool", expect: 404, metric: "probe.unknown_tool" });
      return;
    default:
      await call(a, "availability_check", undefined, { raw: "{no es json", expect: 400, metric: "probe.bad_json" });
  }
}

/** @type {Record<string, (a: Agent) => Promise<unknown>>} */
const ACTIONS = {
  availability_check: availabilityCheck, request_get: requestGet, interest_publish: interestPublish,
  interest_search: interestSearch, interest_withdraw: interestWithdraw, meeting_propose: meetingPropose,
  meeting_inbox: meetingInbox, meeting_get: meetingGet, group_permission: groupPermission, probe,
};
const mix = /** @type {[string, number][]} */ (Object.entries(sc.mix)).filter(([, w]) => w > 0);
for (const [name] of mix) if (!ACTIONS[name]) throw new Error(`mix: acción desconocida "${name}" (${Object.keys(ACTIONS).join(", ")})`);
const totalWeight = mix.reduce((s, [, w]) => s + w, 0);
function chooseAction(/** @type {Agent} */ a) {
  let x = a.r.next() * totalWeight;
  for (const [name, w] of mix) if ((x -= w) < 0) return name;
  return /** @type {string} */ (mix.at(-1)?.[0]);
}

/** @param {Agent} a @param {(a: Agent) => Promise<unknown>} fn */
async function guarded(a, fn) {
  try { await fn(a); } catch (error) {
    inv.check("runner_no_exceptions", false, `${a.id}#${a.seq}`, String(/** @type {any} */ (error)?.stack ?? error).slice(0, 300));
  }
}

// --- Carga -----------------------------------------------------------------------------------
// Cada worker es dueño de un subconjunto fijo de agentes: un agente nunca tiene dos acciones en vuelo.
const deadline = sc.run.durationSec ? Date.now() + sc.run.durationSec * 1000 : Infinity;
const iterations = sc.run.durationSec ? Infinity : sc.run.iterations;
const loadStart = performance.now();
await phase("load", () => Promise.all(Array.from({ length: concurrency }, async (_, w) => {
  const mine = agents.filter((_, i) => i % concurrency === w);
  for (let it = 0; it < iterations && Date.now() < deadline; it++) {
    for (const a of mine) {
      if (Date.now() >= deadline) return;
      await guarded(a, ACTIONS[chooseAction(a)] ?? probe);
      const t = think(a);
      if (t > 0) await sleep(t);
    }
  }
})));
const loadCount = metrics.summary(1).total.count;

// Drenaje: todos los participantes procesan su bandeja hasta que no quede trabajo pendiente.
await phase("drain", async () => {
  const involved = agents.filter(a => meetingsOf.has(a.id));
  for (let round = 1; round <= sc.run.drainRounds; round++) {
    let work = 0;
    await pool(involved, concurrency, async a => guarded(a, async () => { work += await meetingInbox(a); }));
    if (!work) break;
  }
});

// Verificación final de cada encuentro contra el oráculo, y de la base.
await phase("verify", async () => {
  await pool(proposalList, concurrency, async p => {
    const organizer = /** @type {Agent} */ (byId.get(p.organizer));
    const res = await call(organizer, "meeting_get", { id: p.id }, { metric: "final.meeting_get", http: true });
    if (!res.ok) return;
    observe(res.ok, res.reqId);
    const slotOk = p.expected.slot === undefined ? !res.ok.slot : Date.parse(res.ok.slot) === p.expected.slot;
    inv.check("meeting_outcome_matches_oracle", res.ok.status === p.expected.status && slotOk, res.reqId,
      { id: p.id, expected: p.expected.status, got: res.ok.status, slot: res.ok.slot });
  });
  for (const [id, o] of observed) {
    const s = o.statuses;
    const conflict = (s.has("confirmed") && s.has("declined"))
      || (s.has("no_shared_slot") && (s.has("proposed") || s.has("confirmed") || s.has("declined")));
    inv.check("meeting_observations_consistent", !conflict && o.slots.size <= 1, o.reqIds[0],
      { id, statuses: [...s], slots: [...o.slots].map(iso) });
    inv.check("observed_meetings_were_proposed", proposals.has(id), o.reqIds[0], { id });
  }
});
const dbState = await phase("db_checks", () => checkDatabase(db, world, inv, proposals));

// --- Informe ---------------------------------------------------------------------------------
const wallMs = performance.now() - loadStart;
const summary = metrics.summary(wallMs);
const loadRps = Math.round((loadCount / ((phases.load ?? 1) / 1000)) * 10) / 10;
const sideChannel = { hiddenMs: latency(timing.outsider), ghostMs: latency(timing.ghost) };
const result = {
  runId, scenario: sc.name, seed: sc.seed, worldHash: world.hash, api, mcpAgents: agents.filter(a => a.mcp).length,
  concurrency, people: world.people.length, phases, loadRequests: loadCount, loadThroughputRps: loadRps,
  metrics: summary, invariants: inv.summary(), violations: inv.violations, warnings: inv.warnings, db: dbState,
  timingSideChannelInfo: sideChannel, scenarioConfig: sc,
};
console.log("\n" + table(summary));
console.log(`\nCarga: ${loadCount} requests en ${phases.load} ms → ${loadRps} req/s · total ${summary.total.count} requests.`);
console.log(`Base final: ${JSON.stringify(dbState)}`);
console.log(`Sonda de tiempos (info): oculto p50 ${sideChannel.hiddenMs.p50} ms vs inexistente p50 ${sideChannel.ghostMs.p50} ms`);
console.log("\nInvariantes:\n" + inv.report());
await mkdir(resultsDir, { recursive: true });
const file = join(resultsDir, `${runId}.json`);
await writeFile(file, JSON.stringify(result, null, 2) + "\n");
console.log(`\n${inv.violations ? `✗ ${inv.violations} violaciones` : "✓ 0 violaciones"}` +
  `${inv.warnings ? ` (${inv.warnings} avisos conocidos)` : ""} · resultados en ${file}`);

await Promise.allSettled(agents.filter(a => a.mcp).map(a => a.mcp?.close()));
transport.close();
await db.end();
process.exit(inv.violations ? 1 : 0);
