// Escenarios (JSON) y generación determinista del mundo: personas, grupos, permisos,
// calendarios privados e intereses. El mundo también es el oráculo de los invariantes.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { rng } from "./prng.mjs";

const SCENARIOS = new URL("../scenarios/", import.meta.url);
const MINUTE = 60_000;

export const DEFAULTS = {
  seed: 1,
  agents: 10,
  outsiders: 2,
  groups: { count: 3, perAgent: [1, 2], skew: 0 },
  permissions: { canAsk: 0.8, canShare: 0.8, volatile: 0.05 },
  calendar: { start: "2026-12-07T12:00:00.000Z", days: 5, slotsPerDay: 8, slotMinutes: 60, busy: 0.3, halfOffset: 0.2 },
  interests: { vocabulary: 30, perAgent: [0, 3], public: 0.3 },
  meetings: { participants: [2, 4], slots: [2, 4], accept: 0.9 },
  foreign: 0.1,
  mix: {
    availability_check: 40, request_get: 5, interest_publish: 5, interest_search: 15, interest_withdraw: 3,
    meeting_propose: 10, meeting_inbox: 15, meeting_get: 3, group_permission: 1, probe: 3,
  },
  run: { iterations: 20, durationSec: 0, concurrency: 0, thinkMs: [0, 20], drainRounds: 30 },
};

const WORDS = ["fútbol", "música", "ajedrez", "programación", "cocina", "escalada", "café", "cine",
  "lectura", "yoga", "trekking", "diseño"];

/** @param {any} base @param {any} extra @returns {any} */
function merge(base, extra) {
  if (extra === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return extra;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) out[key] = merge(base[key], value);
  return out;
}

export function listScenarios() {
  return readdirSync(SCENARIOS).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
}

/** @param {string} nameOrPath @param {any} [overrides] */
export function loadScenario(nameOrPath, overrides = {}) {
  const url = /[/\\]|\.json$/.test(nameOrPath) ? nameOrPath : new URL(`${nameOrPath}.json`, SCENARIOS);
  if (!existsSync(url)) {
    throw new Error(`Escenario desconocido "${nameOrPath}". Disponibles: ${listScenarios().join(", ")}`);
  }
  const raw = JSON.parse(readFileSync(url, "utf8"));
  const scenario = merge(merge(DEFAULTS, raw), overrides);
  scenario.name ??= String(nameOrPath);
  if (!Number.isInteger(scenario.agents) || scenario.agents < 2) throw new Error("agents debe ser un entero >= 2");
  return scenario;
}

/** @param {any} sc */
export function generateWorld(sc) {
  const r = rng(`world|${sc.seed}`);
  const width = Math.max(4, String(sc.agents + sc.outsiders).length);
  const pad = (/** @type {number} */ n) => String(n).padStart(width, "0");
  const agents = Array.from({ length: sc.agents }, (_, i) => `a${pad(i + 1)}`);
  const outsiders = Array.from({ length: sc.outsiders }, (_, i) => `o${pad(i + 1)}`);
  const ghosts = Array.from({ length: 16 }, (_, i) => `z${pad(i + 1)}`); // nunca se insertan
  const groups = Array.from({ length: sc.groups.count }, (_, i) => `grp${String(i + 1).padStart(3, "0")}`);
  const marker = "privado-" + createHash("sha256").update(`marker|${sc.seed}`).digest("hex").slice(0, 12);

  // Membresías: k grupos por agente, con sesgo opcional (skew>0 concentra gente en los primeros grupos).
  const weights = groups.map((_, i) => 1 / Math.pow(i + 1, sc.groups.skew));
  /** @type {{person:string, group:string, canAsk:boolean, canShare:boolean, volatile:boolean}[]} */
  const memberships = [];
  for (const person of agents) {
    const k = Math.min(r.range(sc.groups.perAgent), groups.length);
    const chosen = new Set();
    while (chosen.size < k) {
      let x = r.next() * weights.reduce((sum, w, i) => sum + (chosen.has(i) ? 0 : w), 0);
      let pick = -1;
      for (let i = 0; i < groups.length; i++) {
        if (chosen.has(i)) continue;
        pick = i;
        if ((x -= /** @type {number} */ (weights[i])) < 0) break;
      }
      chosen.add(pick);
    }
    for (const i of [...chosen].sort((a, b) => a - b)) {
      memberships.push({
        person, group: /** @type {string} */ (groups[i]),
        canAsk: r.chance(sc.permissions.canAsk), canShare: r.chance(sc.permissions.canShare),
        volatile: r.chance(sc.permissions.volatile),
      });
    }
  }

  // Calendario: grilla de bloques; cada bloque ocupado con probabilidad `busy` (a veces desfasado media hora).
  const cal = sc.calendar;
  const start = Date.parse(cal.start);
  const grid = [];
  for (let d = 0; d < cal.days; d++) {
    for (let s = 0; s < cal.slotsPerDay; s++) grid.push(start + d * 1440 * MINUTE + s * cal.slotMinutes * MINUTE);
  }
  /** @type {{person:string, start:number, end:number, title:string}[]} */
  const busy = [];
  for (const person of [...agents, ...outsiders]) {
    for (const cell of grid) {
      if (!r.chance(cal.busy)) continue;
      const begin = cell + (r.chance(cal.halfOffset) ? (cal.slotMinutes / 2) * MINUTE : 0);
      busy.push({ person, start: begin, end: begin + cal.slotMinutes * MINUTE, title: `${marker} cita ${busy.length}` });
    }
  }

  const vocabulary = Array.from({ length: sc.interests.vocabulary }, (_, i) =>
    WORDS[i] ?? `tema-${String(i + 1).padStart(3, "0")}`);
  const groupsOf = new Map(agents.map(p => [p, /** @type {string[]} */ ([])]));
  for (const m of memberships) groupsOf.get(m.person)?.push(m.group);
  const seen = new Set();
  /** @type {{person:string, interest:string, audience:string}[]} */
  const interests = [];
  for (const person of agents) {
    const own = groupsOf.get(person) ?? [];
    for (let k = r.range(sc.interests.perAgent); k > 0; k--) {
      const interest = r.pick(vocabulary);
      const audience = own.length && !r.chance(sc.interests.public) ? r.pick(own) : "";
      const key = `${person}|${interest}|${audience}`;
      if (!seen.has(key)) { seen.add(key); interests.push({ person, interest, audience }); }
    }
  }

  const data = { agents, outsiders, groups, memberships, busy, interests };
  const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
  return new World(sc, data, { ghosts, grid, vocabulary, marker, hash });
}

export class World {
  /** @param {any} sc @param {any} data @param {any} extra */
  constructor(sc, data, extra) {
    Object.assign(this, data, extra);
    /** @type {string[]} */ this.agents = data.agents;
    /** @type {string[]} */ this.outsiders = data.outsiders;
    /** @type {string[]} */ this.groups = data.groups;
    /** @type {string[]} */ this.ghosts = extra.ghosts;
    /** @type {number[]} */ this.grid = extra.grid;
    /** @type {string[]} */ this.vocabulary = extra.vocabulary;
    /** @type {string} */ this.marker = extra.marker;
    /** @type {string} */ this.hash = extra.hash;
    /** @type {{person:string, group:string, canAsk:boolean, canShare:boolean, volatile:boolean}[]} */
    this.memberships = data.memberships;
    /** @type {{person:string, start:number, end:number, title:string}[]} */ this.busy = data.busy;
    /** @type {{person:string, interest:string, audience:string}[]} */ this.interests = data.interests;
    this.slotMinutes = sc.calendar.slotMinutes;
    this.people = [...this.agents, ...this.outsiders];
    this.membership = new Map(this.memberships.map(m => [`${m.person}|${m.group}`, m]));
    /** @type {Map<string, string[]>} */ this.groupsOf = new Map();
    /** @type {Map<string, string[]>} */ this.membersOf = new Map(this.groups.map(g => [g, []]));
    for (const m of this.memberships) {
      this.groupsOf.set(m.person, [...(this.groupsOf.get(m.person) ?? []), m.group]);
      this.membersOf.get(m.group)?.push(m.person);
    }
    /** @type {Map<string, [number, number][]>} */ this.busyOf = new Map();
    for (const b of this.busy) this.busyOf.set(b.person, [...(this.busyOf.get(b.person) ?? []), [b.start, b.end]]);
    /** Publicaciones sembradas: nunca se retiran durante la corrida, así que toda búsqueda debe verlas. */
    /** @type {Map<string, Set<string>>} */ this.listings = new Map();
    for (const i of this.interests) {
      const key = `${i.interest}|${i.audience}`;
      this.listings.set(key, (this.listings.get(key) ?? new Set()).add(i.person));
    }
  }

  /** @param {string} person @param {string} group */
  member(person, group) { return this.membership.get(`${person}|${group}`); }

  /** Misma regla que calendar_is_free: ningún bloque ocupado se solapa con [slot, slot+minutes). */
  /** @param {string} person @param {number} slot @param {number} minutes */
  isFree(person, slot, minutes) {
    const end = slot + minutes * MINUTE;
    return !(this.busyOf.get(person) ?? []).some(([s, e]) => s < end && e > slot);
  }

  /**
   * Oráculo de permiso (requester puede leer a recipient en group). null = indeterminado porque
   * la membresía del recipient es "volátil" (un agente la revoca y restaura durante la corrida).
   * @param {string} requester @param {string} recipient @param {string} group
   */
  allowed(requester, recipient, group) {
    const asker = this.member(requester, group);
    const owner = this.member(recipient, group);
    if (owner?.volatile && asker?.canAsk) return null;
    return Boolean(asker?.canAsk && owner?.canShare);
  }
}
