import { expect, it } from "vitest";

import { activityStream } from "./activity-stream";

it("forwards the activity without an id when the version contains an invalid character", async () => {
  const item = {
    requestId: "request-123",
    from: "ana@sideband.app",
    to: "bob@sideband.app",
    tool: "question",
    status: "no_data",
    createdAt: "2026-11-21T12:00:00Z",
    expiresAt: "2026-11-21T12:15:00Z",
    events: [],
    direction: "sent",
  };
  const id = "Z".repeat(42) + "/";
  const frame = `event: activity\nid: ${id}\ndata: ${JSON.stringify(item)}\n\n`;
  const stream = activityStream(new Blob([frame]).stream(), new AbortController().signal, async () => true);

  const body = await new Response(stream).text();
  expect(body).not.toMatch(/^id:/m);
  expect(body).toContain(`"requestId":"${item.requestId}"`);
});
