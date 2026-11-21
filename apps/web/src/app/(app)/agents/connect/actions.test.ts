import type { OwnerPort } from "@team-31/broker-client";
import type { ActivityEvent, ActivityItem, RequestStatus } from "@team-31/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readPingStatus, saveWake } from "./actions";

const { activity, setWake, agents, sendPing, emit } = vi.hoisted(() => ({
  activity: vi.fn<OwnerPort["activity"]>(), setWake: vi.fn<OwnerPort["setWake"]>(),
  agents: vi.fn(), sendPing: vi.fn<OwnerPort["ping"]>(), emit: vi.fn(),
}));
vi.mock("./connections", () => ({
  connectContext: async () => ({ owner: { userId: "ana" }, broker: { activity, setWake, agents, ping: sendPing } }),
}));
vi.mock("@/lib/telemetry", () => ({
  observeWebRequest: (_method: string, _route: string, run: (span: { setErrorId: () => void }) => unknown) => run({ setErrorId: vi.fn() }),
  getTelemetry: () => ({ identify: vi.fn(), emit, error: () => "error-1" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const at = "2026-11-21T12:00:00Z";

function ping(status: RequestStatus, events: ActivityEvent[]): ActivityItem {
  return {
    requestId: "ping-1",
    from: "system@sideband.app",
    to: "ana@sideband.app",
    tool: "question",
    direction: "received",
    createdAt: at,
    expiresAt: "2026-11-21T12:15:00Z",
    status,
    events,
  };
}

describe("readPingStatus", () => {
  it.each(["no_data", "answered"] as const)("verifies the agent's final %s reply", async (status) => {
    activity.mockResolvedValue([ping(status, [{ kind: "response", status, at }])]);

    expect(await readPingStatus("ping-1")).toEqual({ status, verified: true });
    expect(activity).toHaveBeenCalledWith({ userId: "ana" }, { requestId: "ping-1" });
  });

  it("does not verify a test that the owner answered after escalation", async () => {
    activity.mockResolvedValue([ping("answered", [
      { kind: "response", status: "awaiting_owner", at },
      { kind: "delivery", status: "answered", at },
    ])]);

    expect(await readPingStatus("ping-1")).toEqual({ status: "answered", verified: false });
  });

  it("keeps waiting after the notice and distinguishes a failed test", async () => {
    const events = [{ kind: "wake", status: "awaiting_agent", at }] satisfies ActivityEvent[];
    activity.mockResolvedValue([ping("awaiting_agent", events)]);
    expect(await readPingStatus("ping-1")).toEqual({ status: "awaiting_agent", verified: false });

    activity.mockResolvedValue([ping("expired", events)]);
    expect(await readPingStatus("ping-1")).toEqual({ status: "expired", verified: false });
  });

  it("does not treat a regular answered request as a connection test", async () => {
    activity.mockResolvedValue([{
      ...ping("answered", [{ kind: "response", status: "answered", at }]),
      from: "contacto@sideband.app",
    }]);

    expect(await readPingStatus("ping-1")).toBeUndefined();
  });

  it("returns no status when the request is absent from the owner's activity", async () => {
    activity.mockResolvedValue([]);

    expect(await readPingStatus("ping-1")).toBeUndefined();
  });
});

describe("Grok Bot wake setup", () => {
  const agentId = "grok-test";
  const owner = { userId: "ana" };
  const url = "https://example.test/routine";
  const key = "local-test-credential";

  function fields(secret = key) {
    const form = new FormData();
    form.set("url", url);
    form.set("secret", secret);
    return form;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    agents.mockResolvedValue([{ agentId, wakeKind: "grokbot_routine" }]);
    sendPing.mockResolvedValue({ requestId: "ping-1" });
  });

  it("saves the owner's routine and returns the ping to follow", async () => {
    expect(await saveWake("grokbot", agentId, {}, fields())).toEqual({ requestId: "ping-1" });
    expect(setWake).toHaveBeenCalledWith(owner, agentId, { kind: "grokbot_routine", url, key });
    expect(sendPing).toHaveBeenCalledWith(owner, agentId);
    expect(emit).toHaveBeenCalledWith("web.agent.wake_configured", {
      userId: "ana", agentId, attrs: { kind: "grokbot_routine" },
    });
  });

  it("rejects a copied authorization header before changing the existing wake", async () => {
    expect(await saveWake("grokbot", agentId, {}, fields("Authorization: Bearer " + key))).toHaveProperty("error");
    expect(setWake).not.toHaveBeenCalled();
    expect(sendPing).not.toHaveBeenCalled();
  });

  it("keeps the saved routine when the probe fails and offers a retry", async () => {
    sendPing.mockRejectedValueOnce(new Error());
    expect(await saveWake("grokbot", agentId, {}, fields())).toMatchObject({ error: expect.stringContaining("quedó guardado"), errorId: "error-1" });
    expect(setWake).toHaveBeenCalledTimes(1);
  });

  it("removes the wake without requiring its credential or sending a ping", async () => {
    const form = new FormData();
    form.set("operation", "remove");
    expect(await saveWake("grokbot", agentId, {}, form)).toHaveProperty("message");
    expect(setWake).toHaveBeenCalledWith(owner, agentId, { kind: "none" });
    expect(sendPing).not.toHaveBeenCalled();
  });
});
