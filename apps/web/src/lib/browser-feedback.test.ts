import { createTelemetry, memorySink } from "@team-31/telemetry";
import { beforeEach, expect, it, vi } from "vitest";

import { reportBrowserFailure } from "./browser-feedback";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("./auth", () => ({ getSession }));
vi.mock("./telemetry", () => ({ getTelemetry: () => telemetry }));

const sink = memorySink();
const telemetry = createTelemetry({ service: "web", sink, lifecycle: false });

beforeEach(() => {
  sink.clear();
  getSession.mockReset();
});

it.each(["copy_invite", "share_invite", "copy_connection", "start_google"] as const)(
  "links the error ID for %s to the browser operation and its session",
  async (operation) => {
    const session = operation === "start_google" ? null : { user: { id: "owner-1" } };
    getSession.mockResolvedValue(session);

    const errorId = await reportBrowserFailure(operation);

    expect(errorId).toEqual(expect.any(String));
    expect(sink.find("error")).toEqual([expect.objectContaining({
      errorId,
      userId: session?.user.id ?? null,
      attrs: expect.objectContaining({ operation: `web.browser.${operation}` }),
    })]);
  },
);

it("discards free text supplied as the operation before reading the session or logging it", async () => {
  // @ts-expect-error A browser can send an arbitrary value to the Server Action.
  expect(await reportBrowserFailure("copy_invite: clipboard contents")).toBeUndefined();

  expect(getSession).not.toHaveBeenCalled();
  expect(sink.records).toHaveLength(0);
});
