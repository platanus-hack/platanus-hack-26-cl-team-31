import { BrokerError, type OwnerPort } from "@team-31/broker-client";
import { revalidatePath } from "next/cache";
import { beforeEach, expect, it, vi } from "vitest";

import { pingOrRevokeAgent, readAgents } from "./actions";

const { broker, getOwnerAddress } = vi.hoisted(() => ({
  broker: {
    agents: vi.fn<OwnerPort["agents"]>(),
    ping: vi.fn<OwnerPort["ping"]>(),
    revokeAgent: vi.fn<OwnerPort["revokeAgent"]>(),
  },
  getOwnerAddress: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-owner", () => ({ getOwnerUser: async () => ({ id: "ana" }), getOwnerAddress }));
vi.mock("@/lib/broker", () => ({ ownerClient: () => broker }));
vi.mock("@/lib/telemetry", () => ({ getTelemetry: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const owner = { userId: "ana" };
const agentId = "calendar-agent";

function agentForm(operation?: string) {
  const form = new FormData();
  if (operation) form.set("operation", operation);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  getOwnerAddress.mockResolvedValue("ana@sideband.app");
});

it("reads the signed-in owner's connections", async () => {
  const connection = { agentId, label: "Calendario", wakeKind: "none", createdAt: "2026-11-21T12:00:00Z" } as const;
  broker.agents.mockResolvedValue([connection]);

  expect(await readAgents()).toEqual([connection]);
  expect(broker.agents).toHaveBeenCalledExactlyOnceWith(owner);
});

it.each([
  ["ping", "ping", "revokeAgent", "Prueba solicitada. Revisa su estado en Actividad."],
  ["revoke", "revokeAgent", "ping", "Agente desconectado."],
] as const)("applies %s to the selected connection and refreshes its views", async (operation, method, otherMethod, message) => {
  const form = agentForm(operation);
  form.set("userId", "bob");
  form.set("agentId", "another-agent");

  expect(await pingOrRevokeAgent(agentId, {}, form)).toEqual({ message });
  expect(broker[method]).toHaveBeenCalledExactlyOnceWith(owner, agentId);
  expect(broker[otherMethod]).not.toHaveBeenCalled();
  for (const path of ["/agents", "/activity", "/"]) expect(revalidatePath).toHaveBeenCalledWith(path);
});

it.each([
  ["", "revoke"],
  [agentId, undefined],
  [agentId, "disconnect"],
] as const)("rejects agent %j and operation %j without modifying a connection", async (id, operation) => {
  expect(await pingOrRevokeAgent(id, {}, agentForm(operation))).toHaveProperty("error");
  expect(broker.ping).not.toHaveBeenCalled();
  expect(broker.revokeAgent).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("requires an owner address before disconnecting an agent", async () => {
  getOwnerAddress.mockResolvedValue(undefined);

  await expect(pingOrRevokeAgent(agentId, {}, agentForm("revoke"))).rejects.toThrow();
  expect(broker.revokeAgent).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("returns the broker error ID when the selected agent is no longer available", async () => {
  broker.ping.mockRejectedValue(new BrokerError("not_found", "agent unavailable", { errorId: "error-1" }));

  expect(await pingOrRevokeAgent(agentId, {}, agentForm("ping"))).toEqual({
    error: "El elemento ya no está disponible.", errorId: "error-1",
  });
  expect(revalidatePath).not.toHaveBeenCalled();
});
