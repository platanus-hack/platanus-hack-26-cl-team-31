// Forma exacta esperada de cada respuesta 200 (claves de más también son violación:
// una clave inesperada es justamente cómo se filtraría un dato privado).
// Cada validador devuelve null si la forma es válida o un string con el motivo.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES = ["collecting", "no_shared_slot", "proposed", "declined", "confirmed"];
const isObject = (/** @type {any} */ o) => typeof o === "object" && o !== null && !Array.isArray(o);
const isIso = (/** @type {any} */ s) => typeof s === "string" && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s;

/** @param {any} o @param {string[]} required @param {string[]} [optional] */
function keys(o, required, optional = []) {
  if (!isObject(o)) return "no es un objeto";
  const extra = Object.keys(o).filter(k => !required.includes(k) && !optional.includes(k));
  if (extra.length) return `claves inesperadas: ${extra.join(",")}`;
  const missing = required.filter(k => !(k in o));
  return missing.length ? `faltan claves: ${missing.join(",")}` : null;
}

const denied = (/** @type {any} */ o) => isObject(o) && o.status === "not_shareable" && Object.keys(o).length === 1;
/** @param {string} status */
const exactly = status => (/** @type {any} */ o) => keys(o, ["status"]) ?? (o.status === status ? null : `status=${o.status}`);
/** @param {(o: any) => string | null} check */
const orDenied = check => (/** @type {any} */ o) => (denied(o) ? null : check(o));

/** @param {any} o */
function availability(o) {
  return keys(o, ["status", "request_id"]) ??
    (["available", "busy"].includes(o.status) ? null : `status=${o.status}`) ??
    (UUID.test(o.request_id) ? null : "request_id no es uuid");
}

/** @param {any} o */
export function meetingView(o) {
  const bad = keys(o, ["id", "organizer", "participants", "minutes", "status"], ["slots", "slot"]);
  if (bad) return bad;
  if (!UUID.test(o.id)) return "id no es uuid";
  if (!STATUSES.includes(o.status)) return `status=${o.status}`;
  if (!Number.isInteger(o.minutes)) return "minutes no es entero";
  if (!Array.isArray(o.participants) || !o.participants.every((/** @type {any} */ p) => typeof p === "string")) return "participants";
  if (o.participants.some((/** @type {string} */ p, /** @type {number} */ i) => i > 0 && o.participants[i - 1] >= p)) return "participants sin orden";
  if (!o.participants.includes(o.organizer)) return "organizer fuera de participants";
  if ((o.status === "collecting") !== ("slots" in o)) return "slots sólo mientras collecting";
  if ("slots" in o && !(Array.isArray(o.slots) && o.slots.every(isIso))) return "slots no ISO";
  const hasSlot = ["proposed", "declined", "confirmed"].includes(o.status);
  if (hasSlot !== ("slot" in o)) return `slot inesperado para ${o.status}`;
  if ("slot" in o && !isIso(o.slot)) return "slot no ISO";
  return null;
}

/** @type {Record<string, (o: any) => string | null>} */
export const shapes = {
  availability_check: orDenied(availability),
  request_get: orDenied(availability),
  group_permission: orDenied(o => keys(o, ["status", "can_ask", "can_share"]) ??
    (o.status === "updated" && typeof o.can_ask === "boolean" && typeof o.can_share === "boolean" ? null : "valores")),
  group_leave: exactly("left"),
  interest_publish: orDenied(exactly("published")),
  interest_withdraw: exactly("withdrawn"),
  interest_search: o => {
    const bad = keys(o, ["entries"]);
    if (bad) return bad;
    if (!Array.isArray(o.entries)) return "entries no es arreglo";
    for (const e of o.entries) {
      const why = keys(e, ["person", "interest"]);
      if (why) return `entry: ${why}`;
      if (typeof e.person !== "string" || typeof e.interest !== "string") return "entry con tipos inválidos";
    }
    return null;
  },
  meeting_propose: orDenied(meetingView),
  meeting_respond: orDenied(meetingView),
  meeting_get: orDenied(meetingView),
  meeting_decide: orDenied(meetingView),
  meeting_inbox: o => {
    const bad = keys(o, ["meetings"]);
    if (bad) return bad;
    if (!Array.isArray(o.meetings)) return "meetings no es arreglo";
    for (const m of o.meetings) {
      const why = meetingView(m);
      if (why) return `meeting: ${why}`;
    }
    return null;
  },
};

/** Cuerpo de error 4xx: sólo {error: string}. @param {any} o */
export const errorShape = o => keys(o, ["error"]) ?? (typeof o.error === "string" ? null : "error no es string");
