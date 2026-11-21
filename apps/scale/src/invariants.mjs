// Registro de invariantes y chequeos sobre el estado final de la base.
// Para agregar un invariante: llama a `inv.check(nombre, ok, reqId, detalle)` donde tengas el dato
// (respuesta en run.mjs o una consulta en DB_CHECKS) y documenta su nombre en AGENTS.md.

export class Invariants {
  constructor() {
    /** @type {Map<string, {checked: number, failed: number, warn: boolean, samples: {reqId: string, detail: unknown}[]}>} */
    this.items = new Map();
  }

  /** @param {string} name @param {boolean} ok @param {string} [reqId] @param {unknown} [detail] */
  check(name, ok, reqId = "-", detail = undefined, warn = false) {
    let item = this.items.get(name);
    if (!item) this.items.set(name, item = { checked: 0, failed: 0, warn, samples: [] });
    item.checked++;
    if (ok) return true;
    item.failed++;
    if (item.samples.length < 5) item.samples.push({ reqId, detail });
    return false;
  }

  /** Desvío conocido del servidor: se informa pero no hace fallar la corrida. */
  /** @param {string} name @param {boolean} ok @param {string} [reqId] @param {unknown} [detail] */
  warn(name, ok, reqId, detail) {
    return this.check(name, ok, reqId, detail, true);
  }

  get violations() {
    return [...this.items.values()].reduce((n, i) => n + (i.warn ? 0 : i.failed), 0);
  }

  get warnings() {
    return [...this.items.values()].reduce((n, i) => n + (i.warn ? i.failed : 0), 0);
  }

  summary() {
    return Object.fromEntries([...this.items].sort(([a], [b]) => a.localeCompare(b)));
  }

  report() {
    const lines = [];
    for (const [name, i] of [...this.items].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${!i.failed ? " ok " : i.warn ? "WARN" : "FAIL"}  ${name.padEnd(34)} ${String(i.checked).padStart(7)} chequeos` +
        (i.failed ? `, ${i.failed} violaciones` : ""));
      for (const s of i.samples) lines.push(`        ${s.reqId}  ${JSON.stringify(s.detail)?.slice(0, 300)}`);
    }
    return lines.join("\n");
  }
}

// Cada consulta devuelve las filas que violan el invariante (vacío = ok).
const DB_CHECKS = {
  db_confirmed_requires_all_accepted: `SELECT m.id FROM meetings m WHERE m.status = 'confirmed'
    AND EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id AND p.accepted IS NOT TRUE)`,
  db_declined_requires_a_decline: `SELECT m.id FROM meetings m WHERE m.status = 'declined'
    AND NOT EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id AND p.accepted IS FALSE)`,
  db_outcome_after_all_answered: `SELECT m.id FROM meetings m WHERE m.status <> 'collecting'
    AND EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id AND p.free_slots IS NULL)`,
  db_decisions_only_after_proposal: `SELECT m.id FROM meetings m JOIN meeting_participants p ON p.meeting_id = m.id
    WHERE m.status IN ('collecting', 'no_shared_slot') AND p.accepted IS NOT NULL`,
  db_selected_slot_consistent: `SELECT id FROM meetings WHERE
    (status IN ('proposed', 'confirmed', 'declined') AND (selected_slot IS NULL OR NOT selected_slot = ANY(slots)))
    OR (status IN ('collecting', 'no_shared_slot') AND selected_slot IS NOT NULL)`,
  db_selected_slot_free_for_all: `SELECT m.id, p.person_id FROM meetings m JOIN meeting_participants p ON p.meeting_id = m.id
    WHERE m.selected_slot IS NOT NULL AND NOT (m.selected_slot = ANY(p.free_slots))`,
  db_free_slots_match_calendar: `SELECT m.id, p.person_id, s FROM meetings m
    JOIN meeting_participants p ON p.meeting_id = m.id CROSS JOIN LATERAL unnest(m.slots) s
    WHERE p.free_slots IS NOT NULL AND (s = ANY(p.free_slots)) <> calendar_is_free(p.person_id, s, m.minutes)`,
  db_no_stuck_meetings: `SELECT id, status FROM meetings WHERE status IN ('collecting', 'proposed')`,
};

/**
 * @param {import("pg").ClientBase} db
 * @param {import("./world.mjs").World} world
 * @param {Invariants} inv
 * @param {Map<string, {participants: string[]}>} proposals
 */
export async function checkDatabase(db, world, inv, proposals) {
  for (const [name, sql] of Object.entries(DB_CHECKS)) {
    const { rows } = await db.query(`${sql} LIMIT 5`);
    inv.check(name, rows.length === 0, "db", rows);
  }
  const people = new Set(world.people);

  // Membresías: los cambios temporales de permisos deben haberse restaurado sin pérdidas.
  const { rows: members } = await db.query("SELECT person_id, group_id, can_ask, can_share FROM memberships");
  const seen = new Set();
  for (const r of members.filter(r => people.has(r.person_id))) {
    const m = world.member(r.person_id, r.group_id);
    seen.add(`${r.person_id}|${r.group_id}`);
    inv.check("db_memberships_restored", Boolean(m && m.canAsk === r.can_ask && m.canShare === r.can_share), "db", r);
  }
  inv.check("db_memberships_restored", seen.size === world.memberships.length, "db",
    { expected: world.memberships.length, found: seen.size });

  // Respuestas de disponibilidad guardadas sólo cuando el permiso existía.
  const { rows: requests } = await db.query("SELECT requester, recipient, group_id FROM availability_requests");
  for (const r of requests.filter(r => people.has(r.requester))) {
    inv.check("db_requests_were_permitted", world.allowed(r.requester, r.recipient, r.group_id) !== false, "db", r);
  }

  // Publicaciones de grupo sólo de miembros; temas normalizados.
  const { rows: listings } = await db.query("SELECT person_id, interest, audience FROM interests");
  for (const r of listings.filter(r => people.has(r.person_id))) {
    inv.check("db_listings_by_members", r.audience === "" || Boolean(world.member(r.person_id, r.audience)), "db", r);
    inv.check("db_listings_normalized", r.interest === r.interest.normalize("NFC").toLowerCase(), "db", r);
  }

  // Cada encuentro de la base corresponde a una propuesta aceptada, con los mismos participantes.
  const { rows: meetings } = await db.query(`SELECT m.id, array_agg(p.person_id ORDER BY p.person_id) AS participants
    FROM meetings m JOIN meeting_participants p ON p.meeting_id = m.id GROUP BY m.id`);
  for (const r of meetings) {
    const proposal = proposals.get(r.id);
    inv.check("db_meetings_match_proposals",
      Boolean(proposal && proposal.participants.join(",") === r.participants.join(",")), "db", r);
  }

  const counts = await db.query(`SELECT
    (SELECT count(*) FROM people)::int AS people, (SELECT count(*) FROM memberships)::int AS memberships,
    (SELECT count(*) FROM busy_slots)::int AS busy_slots, (SELECT count(*) FROM interests)::int AS interests,
    (SELECT count(*) FROM availability_requests)::int AS availability_requests,
    (SELECT count(*) FROM meeting_participants)::int AS meeting_participants`);
  const byStatus = await db.query("SELECT status, count(*)::int AS n FROM meetings GROUP BY status ORDER BY status");
  const busy = await db.query("SELECT count(*)::int AS n FROM busy_slots WHERE person_id = ANY($1)", [world.people]);
  inv.check("db_busy_slots_untouched", busy.rows[0].n === world.busy.length, "db",
    { expected: world.busy.length, found: busy.rows[0].n });
  return { ...counts.rows[0], meetings: Object.fromEntries(byStatus.rows.map(r => [r.status, r.n])) };
}
