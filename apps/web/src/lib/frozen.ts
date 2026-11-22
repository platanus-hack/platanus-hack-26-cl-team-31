import "server-only";

import type { OwnerPort } from "@team-31/broker-client";
import type { ActivityItem, AgentConnection, Circle, ContactsView, OwnerPendingItem, OwnerVault } from "@team-31/protocol";

export const frozen = process.env.UI_FROZEN === "1" && process.env.NODE_ENV !== "production";

const me = "ana@sideband.app";
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

export const frozenSession = {
  session: { id: "frozen", userId: "frozen-user", token: "frozen", expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(), updatedAt: new Date() },
  user: { id: "frozen-user", name: "Ana Rojas", email: "ana.rojas@example.com", emailVerified: true, image: null, createdAt: new Date("2026-11-01T12:00:00Z"), updatedAt: new Date() },
};

const contacts: ContactsView = {
  contacts: [
    { address: "bruno@sideband.app", displayName: "Bruno Díaz", tags: ["friend"], gives: ["availability", "interests"], receives: ["availability", "interests"] },
    { address: "carla@sideband.app", displayName: "Carla Muñoz", tags: ["family", "futbol"], gives: ["availability", "interests", "health", "general"], receives: ["availability", "health"] },
    { address: "diego@sideband.app", displayName: "Diego Soto", tags: ["work"], gives: ["availability"], receives: ["availability"] },
    { address: "elena@sideband.app", tags: ["friend"], gives: ["interests"], receives: ["availability", "interests"] },
  ],
  tags: [
    { id: "friend", name: "Amigo", color: "emerald", categories: ["availability", "interests"] },
    { id: "family", name: "Familia", color: "amber", categories: ["availability", "interests", "health", "general"] },
    { id: "work", name: "Trabajo", color: "violet", categories: ["availability"] },
    { id: "futbol", name: "Fútbol", color: "sky", categories: ["availability"] },
  ],
  incoming: [
    { requestId: "inv-0", address: "felipe@sideband.app", offer: ["availability", "interests"], expiresAt: hours(20) },
    { requestId: "inv-1", address: "hugo@sideband.app", offer: ["availability"], expiresAt: hours(23) },
    { requestId: "inv-2", address: "irene@sideband.app", offer: ["interests"], expiresAt: hours(26) },
    { requestId: "inv-3", address: "javier@sideband.app", offer: ["availability", "interests", "general"], expiresAt: hours(29) },
    { requestId: "inv-4", address: "karla@sideband.app", offer: ["availability", "interests"], expiresAt: hours(32) },
    { requestId: "inv-5", address: "lucas@sideband.app", offer: ["availability"], expiresAt: hours(35) },
    { requestId: "inv-6", address: "marta@sideband.app", offer: ["interests"], expiresAt: hours(38) },
    { requestId: "inv-7", address: "nicolas@sideband.app", offer: ["availability", "interests", "general"], expiresAt: hours(41) },
  ],
  outgoing: [{ requestId: "inv-2", address: "gabriela@sideband.app", offer: ["availability"], expiresAt: hours(48) }],
};

const circles: Circle[] = [
  { id: "c1", name: "Fútbol del sábado", owner: me, members: [{ address: me, joined: true }, { address: "bruno@sideband.app", joined: true }, { address: "diego@sideband.app", joined: false }] },
  { id: "c3", name: "Pega", owner: me, members: [{ address: me, joined: true }, { address: "diego@sideband.app", joined: true }, { address: "elena@sideband.app", joined: true }, { address: "hugo@sideband.app", joined: true }, { address: "irene@sideband.app", joined: true }, { address: "javier@sideband.app", joined: true }] },
  { id: "c4", name: "Asado del domingo", owner: "bruno@sideband.app", members: [{ address: "bruno@sideband.app", joined: true }, { address: me, joined: true }, { address: "carla@sideband.app", joined: true }] },
  { id: "i0", name: "Running del martes", owner: "diego@sideband.app", members: [{ address: "diego@sideband.app", joined: true }, { address: "bruno@sideband.app", joined: true }, { address: me, joined: false }] },
  { id: "i1", name: "Club de lectura", owner: "elena@sideband.app", members: [{ address: "elena@sideband.app", joined: true }, { address: "bruno@sideband.app", joined: true }, { address: me, joined: false }] },
  { id: "i2", name: "Pádel", owner: "hugo@sideband.app", members: [{ address: "hugo@sideband.app", joined: true }, { address: "bruno@sideband.app", joined: true }, { address: me, joined: false }] },
  { id: "c2", name: "Familia", owner: "carla@sideband.app", members: [{ address: "carla@sideband.app", joined: true }, { address: me, joined: false }] },
];

const pending: OwnerPendingItem[] = [
  { requestId: "r1", from: "bruno@sideband.app", tool: "availability", args: { date: "2026-11-28", start: "19:00", durationMinutes: 90, timezone: "America/Santiago" }, senderMessage: { text: "¿Juegas el viernes?", trusted: false }, expiresAt: hours(5) },
  { requestId: "r2", from: "carla@sideband.app", tool: "question", args: { text: "¿Cómo sigues de la rodilla?", category: "health" }, escalated: true, senderMessage: { text: "", trusted: false }, expiresAt: hours(20) },
  { requestId: "r3", from: "diego@sideband.app", tool: "vault_access", args: { categoryName: "Lista de regalos" }, senderMessage: { text: "Para el amigo secreto", trusted: false }, expiresAt: hours(12) },
];

export const frozenActivity: ActivityItem[] = [
  { direction: "received", requestId: "a1", from: "bruno@sideband.app", to: me, tool: "interest_check", status: "answered", createdAt: hours(-2), expiresAt: hours(20), closedAt: hours(-1.9), events: [{ kind: "received", at: hours(-2) }, { kind: "response", at: hours(-1.9), status: "answered" }] },
  { direction: "sent", requestId: "a2", from: me, to: "carla@sideband.app", tool: "availability", status: "awaiting_owner", createdAt: hours(-5), expiresAt: hours(19), events: [{ kind: "received", at: hours(-5) }] },
  { direction: "received", requestId: "a3", from: "hector@sideband.app", to: me, tool: "question", status: "denied", createdAt: hours(-26), expiresAt: hours(-2), closedAt: hours(-26), events: [{ kind: "permission", at: hours(-26), status: "denied" }] },
];

const agents: AgentConnection[] = [
  { agentId: "claude-code", label: "Claude Code", wakeKind: "standard_webhook", verifiedAt: hours(-48), lastWakeAt: hours(-3), createdAt: hours(-72) },
  { agentId: "cursor-ana", label: "Cursor", wakeKind: "mcp_events", createdAt: hours(-24) },
];

const vault: OwnerVault = {
  categories: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Lista de regalos", visibility: "private", tags: ["family"], entries: [{ label: "Libro", value: "Cualquiera de Ursula K. Le Guin" }], members: ["carla@sideband.app"] },
    { id: "22222222-2222-4222-8222-222222222222", name: "Talla de ropa", visibility: "private", tags: [], entries: [{ label: "Polera", value: "M" }] },
  ],
};

const later = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 400));
const done = () => later(undefined);
const view = () => later({ requestId: "frozen", final: false, decision: "pending", waitingFor: "owner" }) as never;

export const frozenOwnerClient: OwnerPort = {
  searchPublicProfiles: () => later([]),
  directory: () => later({ contacts: [], circles: [] }) as never,
  queryVault: () => later({ categories: [] }),
  tags: () => later({ tags: contacts.tags.map((tag) => ({ ...tag, members: contacts.contacts.filter((c) => c.tags.includes(tag.id)).map((c) => c.address) })) }),
  createTag: (_, input) => later({ id: "new", categories: [], color: "slate", ...input }) as never,
  updateTag: (_, id, input) => later({ ...contacts.tags.find((tag) => tag.id === id), ...input }) as never,
  deleteTag: done,
  vault: () => later(vault),
  changeVault: () => later({}) as never,
  me: () => later({ userId: "frozen-user", address: me, displayName: "Ana Rojas" }),
  claimAddress: () => later(me),
  grants: () => later([]),
  setGrant: () => later({}) as never,
  revokeGrant: done,
  pending: () => later(pending),
  activity: () => later(frozenActivity),
  ask: view,
  status: view,
  decide: done,
  agentDirectory: () => later([
    { agentId: "claude-code", label: "Claude Code", address: "bruno@sideband.app" },
    { agentId: "cursor", label: "Cursor", address: "diego@sideband.app" },
  ]),
  agents: () => later(agents),
  setWake: done,
  ping: () => later({ requestId: "frozen" }),
  revokeAgent: done,
  connect: view,
  contacts: () => later(contacts),
  setSharing: done,
  setContactTags: done,
  answerInvitation: done,
  circles: () => later(circles),
  createCircle: (_, name) => later({ id: "new", name, owner: me, members: [{ address: me, joined: true }] }),
  deleteCircle: done,
  inviteToCircle: done,
  joinCircle: done,
  removeFromCircle: done,
  removeContact: done,
  removeFriend: done,
};
