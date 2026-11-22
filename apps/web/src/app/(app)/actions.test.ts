import { BrokerError } from "@team-31/broker-client";
import { OwnerPendingItem } from "@team-31/protocol";
import { revalidatePath } from "next/cache";
import { beforeEach, expect, it, vi } from "vitest";
import { decide } from "./actions";
import { answerInvitation, saveSharing, saveTag } from "./contacts/actions";
import { getOwner, requireAddress } from "./owner";

const broker = vi.hoisted(() => ({
  answerInvitation: vi.fn(),
  decide: vi.fn(),
  pending: vi.fn<() => Promise<OwnerPendingItem[]>>(),
  setSharing: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/lib/broker", () => ({ ownerClient: () => broker }));
vi.mock("@/lib/onboarding-flow", () => ({ onboardingFlow: vi.fn() }));
vi.mock("@/lib/telemetry", () => ({ getTelemetry: vi.fn(), observeWebRequest: vi.fn() }));
vi.mock("./owner", () => ({ getOwner: vi.fn(), requireAddress: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const owner = { userId: "ana" };
const pending = OwnerPendingItem.parse({
  requestId: "request-1",
  from: "bob@sideband.app",
  tool: "question",
  args: { text: "¿Puedes ayudar?", category: "general" },
  senderMessage: { text: "¿Puedes ayudar?", trusted: false },
  expiresAt: "2026-11-21T18:00:00Z",
  escalated: true,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getOwner).mockResolvedValue(owner);
  vi.mocked(requireAddress).mockResolvedValue("ana@sideband.app");
});

it("uses the signed-in owner and trims the answer to a pending question", async () => {
  broker.pending.mockResolvedValue([pending]);
  const form = new FormData();
  form.set("decision", "answer");
  form.set("answer", "  Sí, puedo.  ");
  form.set("userId", "someone-else");

  await expect(decide(pending.requestId, {}, form)).resolves.toEqual({ message: "Decisión guardada." });
  expect(broker.pending).toHaveBeenCalledWith(owner);
  expect(broker.decide).toHaveBeenCalledWith(owner, pending.requestId, { kind: "answer", result: { answer: "Sí, puedo." } });
  expect(revalidatePath).toHaveBeenCalledWith("/");
  expect(revalidatePath).toHaveBeenCalledWith("/activity");
});

it("rejects decisions for requests outside the owner's pending list", async () => {
  broker.pending.mockResolvedValue([]);
  const form = new FormData();
  form.set("decision", "deny");

  await expect(decide(pending.requestId, {}, form)).resolves.toHaveProperty("error");
  expect(broker.decide).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
});

it.each([
  ["availability", "yes", { date: "2026-11-21", start: "10:00", durationMinutes: 30, timezone: "UTC" }, { available: true }],
  ["interest_check", "no", { interest: "Cerámica" }, { matches: false }],
] as const)("maps the owner's %s decision %s to the correct result", async (tool, decision, args, result) => {
  broker.pending.mockResolvedValue([OwnerPendingItem.parse({ ...pending, tool, args })]);
  const form = new FormData();
  form.set("decision", decision);

  await expect(decide(pending.requestId, {}, form)).resolves.toHaveProperty("message");
  expect(broker.decide).toHaveBeenCalledWith(owner, pending.requestId, { kind: "answer", result });
});

const contact = "bob@sideband.app";

function sharingForm(...shared: string[]) {
  const form = new FormData();
  for (const category of shared) form.append("category", category);
  return form;
}

it("checks sharing categories and revalidates only after saving", async () => {
  await expect(saveSharing(contact, {}, sharingForm("availability", "questions"))).resolves.toHaveProperty("error");
  expect(broker.setSharing).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();

  await expect(saveSharing(contact, {}, sharingForm("availability", "general"))).resolves.toEqual({ message: "Guardado." });
  expect(broker.setSharing).toHaveBeenCalledWith(owner, contact, ["availability", "general"]);
  expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/contacts"], ["/tags"], ["/activity"], ["/"]]);
});

it("maps a broker conflict to owner feedback and preserves the cached page", async () => {
  broker.setSharing.mockRejectedValueOnce(new BrokerError("conflict", "internal detail"));
  await expect(saveSharing(contact, {}, sharingForm("availability"))).resolves.toEqual({
    error: "La solicitud ya cambió. Actualiza la página.",
  });
  expect(revalidatePath).not.toHaveBeenCalled();
});

it.each([
  { categories: ["availability", "health"] },
  { categories: [] },
])("replaces the tag's shared categories with $categories", async ({ categories }) => {
  const form = sharingForm(...categories);
  form.set("name", "Colegas");
  form.set("color", "violet");
  form.set("userId", "someone-else");

  await expect(saveTag("work", {}, form)).resolves.toEqual({ message: "Guardado." });
  expect(broker.updateTag).toHaveBeenCalledWith(owner, "work", { name: "Colegas", color: "violet", categories });
});

it.each([
  { answer: "accept", command: { accept: true, tags: ["family", "work"] }, message: "Ahora están conectados." },
  { answer: "decline", command: { accept: false }, message: "Invitación rechazada." },
])("sends the signed-in owner's $answer decision to the broker", async ({ answer, command, message }) => {
  const form = new FormData();
  form.set("answer", answer);
  form.set("userId", "someone-else");
  form.append("tag", "family");
  form.append("tag", "work");

  await expect(answerInvitation("invitation-2", {}, form)).resolves.toEqual({ message });
  expect(broker.answerInvitation).toHaveBeenCalledWith(owner, "invitation-2", command);
});

it.each([null, "unknown"])("keeps the invitation pending for an invalid answer (%s)", async (answer) => {
  const form = new FormData();
  if (answer !== null) form.set("answer", answer);

  await expect(answerInvitation("invitation-2", {}, form)).resolves.toEqual({ error: "Elige aceptar o rechazar." });
  expect(broker.answerInvitation).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
});
