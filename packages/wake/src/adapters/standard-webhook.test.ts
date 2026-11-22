import { RESULT_EVENT } from "@team-31/protocol";
import { expect, it } from "vitest";
import { standardWebhookPost } from "./standard-webhook.js";

it("identifica el cierre con el webhook-id que espera el receptor", () => {
  const requestId = "b63aed11-340a-4a5c-8659-e210657f8ae4";
  const post = standardWebhookPost(
    { kind: "standard_webhook", url: "https://example.test/wake", secret: "whsec_Zml4dHVyZQ==" },
    { event: RESULT_EVENT, requestId },
  );

  expect(post.headers?.["webhook-id"]).toBe(`evt_closed_${requestId}`);
});
