import type { OwnerPort } from "@team-31/broker/client";
import type { ActivityEvent, ActivityItem, RequestStatus } from "@team-31/protocol";
import { describe, expect, it, vi } from "vitest";

import { readPingStatus } from "./actions";

const { activity } = vi.hoisted(() => ({ activity: vi.fn<OwnerPort["activity"]>() }));
vi.mock("./connections", () => ({
  connectContext: async () => ({ owner: { userId: "ana" }, broker: { activity } }),
}));
vi.mock("../../../../lib/telemetry", () => ({
  observeWebRequest: (_method: string, _route: string, run: () => unknown) => run(),
  getTelemetry: () => ({ identify: vi.fn(), emit: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const at = "2026-11-21T12:00:00Z";

function ping(status: RequestStatus, events: ActivityEvent[]): ActivityItem {
  return {
    requestId: "ping-1",
    from: "system@nexo.app",
    to: "ana@nexo.app",
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
      from: "contacto@nexo.app",
    }]);

    expect(await readPingStatus("ping-1")).toBeUndefined();
  });

  it("returns no status when the request is absent from the owner's activity", async () => {
    activity.mockResolvedValue([]);

    expect(await readPingStatus("ping-1")).toBeUndefined();
  });
});
