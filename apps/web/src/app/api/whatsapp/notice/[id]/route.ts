import { after } from "next/server";
import { WAKE_UPDATE_EVENT, WakeNotice } from "@team-31/protocol";
import { readWebhookBody, verifyWebhookSignature } from "@team-31/wake";
import { ownerClient } from "../../../../../lib/broker";
import { getTelemetry, observeRoute } from "../../../../../lib/telemetry";
import { noticeText } from "../../../../../lib/whatsapp/delivery";
import { config, sendText } from "../../../../../lib/whatsapp/kapso";
import { whatsappStore } from "../../../../../lib/whatsapp/runtime";

const route = "/api/whatsapp/notice/:id";
// Standard Webhooks tolerance: older signed notices are treated as replays.
const toleranceSeconds = 300;

// The broker calls this when a request asked from WhatsApp waits for the recipient's approval or
// closes. The notice carries only the request id: the reply is read with the owner's identity.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const kapso = config();
  const secret = process.env.WHATSAPP_NOTICE_SECRET;
  if (!kapso || !secret?.startsWith("whsec_")) return new Response(null, { status: 404 });
  const telemetry = getTelemetry();
  return observeRoute(request, route, async () => {
    const reply = (status: number, errorId?: string) =>
      new Response(null, { status, headers: errorId ? { "X-Error-Id": errorId } : undefined });
    try {
      const bytes = await readWebhookBody(request, 4_096);
      if (!bytes) return reply(413);
      const body = bytes.toString("utf8");
      const timestamp = Number(request.headers.get("webhook-timestamp"));
      if (!Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds ||
          !verifyWebhookSignature(secret, request.headers.get("webhook-id") ?? "", timestamp, body,
            request.headers.get("webhook-signature") ?? "")) {
        telemetry.emit("auth.token.rejected", { attrs: { issuer: "broker", reason: "signature" } });
        return reply(401);
      }
      telemetry.emit("auth.token.verified", { attrs: { issuer: "broker" } });
      let json: unknown;
      try { json = JSON.parse(body); }
      catch (error) { return reply(400, telemetry.error(route, error)); }
      const notice = WakeNotice.safeParse(json);
      if (!notice.success || notice.data.event !== WAKE_UPDATE_EVENT) return reply(400);
      const { requestId } = notice.data;
      const { id: linkId } = await params;
      const store = whatsappStore();

      after(async () => {
        try {
          await store.whileNotified(linkId, async (link) => {
            if (!link) {
              telemetry.emit("whatsapp.delivery", { requestId, attrs: { state: "dropped" } });
              return;
            }
            const { userId } = link;
            await telemetry.context({ userId, requestId }, async () => {
              const view = await ownerClient().status({ userId }, requestId);
              const text = noticeText(view);
              // Broker retries repeat the notice: each state reaches the phone once.
              if (!text || !await store.claim("notice", `${requestId}:${view.final ? "final" : "owner"}`)) return;
              if (!link.windowOpen) {
                await store.addPending(userId, requestId);
                telemetry.emit("whatsapp.delivery", { requestId, userId, attrs: { state: "pending", decision: view.decision } });
                return;
              }
              await telemetry.span("whatsapp.send", { userId }, () => sendText(kapso, link.phone, text));
              telemetry.emit("whatsapp.delivery", { requestId, userId, attrs: { state: "sent", decision: view.decision } });
            });
          });
        } catch (error) {
          telemetry.error("whatsapp.delivery", error, { requestId });
        }
      });
      return reply(200);
    } catch (error) {
      return reply(503, telemetry.error(route, error));
    }
  });
}
