import { LIFECYCLE_EVENT, WAKE_EVENT } from "@team-31/protocol";
import { expect, it } from "vitest";
import { mcpEventsPost } from "./mcp-events.js";

it("avisa de una solicitud nueva a quien está suscrito al ciclo de vida", () => {
  const notice = { requestId: "req_123", event: WAKE_EVENT } as const;
  const post = mcpEventsPost({
    kind: "mcp_events",
    callbackUrl: "https://example.com/events",
    secret: "whsec_dGVzdA==",
    subscriptionId: "sub_lifecycle",
    refreshBefore: null,
    lifecycle: true,
  }, notice);

  expect(JSON.parse(post.body)).toMatchObject({ name: LIFECYCLE_EVENT, data: notice });
});
