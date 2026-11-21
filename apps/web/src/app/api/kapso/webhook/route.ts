import { after } from "next/server";
import { BrokerError } from "@team-31/broker-client";
import { readWebhookBody } from "@team-31/wake";
import { ownerClient } from "../../../../lib/broker";
import { emptyResponse, getTelemetry, observeRoute } from "../../../../lib/telemetry";
import { registerNoticeChannel } from "../../../../lib/whatsapp/channel";
import { whatsappMessage } from "../../../../lib/whatsapp/message";
import type { RequesterView } from "@team-31/protocol";
import { isConversationInput, runCommand } from "../../../../lib/whatsapp/commands";
import { noticeText } from "../../../../lib/whatsapp/delivery";
import { config, inboundEvent, parseMessage, sendText, validSignature } from "../../../../lib/whatsapp/kapso";
import { whatsappStore, whatsappMessageRuntime } from "../../../../lib/whatsapp/runtime";

const route = "/api/kapso/webhook";

async function flushPending(store: ReturnType<typeof whatsappStore>, phone: string, timestamp: number,
  send: (text: string, userId: string) => Promise<void>) {
  const telemetry = getTelemetry();
  try {
    for (const requestId of await store.pending(phone, timestamp)) {
      try {
        await store.deliverPending(phone, timestamp, requestId, async (userId) => {
          let view;
          try {
            view = await ownerClient().status({ userId }, requestId);
          } catch (error) {
            if (!(error instanceof BrokerError && error.code === "not_found")) throw error;
            telemetry.emit("whatsapp.delivery", { userId, requestId, attrs: { state: "dropped", decision: "not_found" } });
            return;
          }
          const text = noticeText(view);
          if (text) await send(text, userId);
          telemetry.emit("whatsapp.delivery", { userId, requestId, attrs: { state: "flushed", decision: view.decision } });
        });
      } catch (error) {
        telemetry.error("whatsapp.pending.send", error, { requestId });
      }
    }
  } catch (error) {
    telemetry.error("whatsapp.pending.list", error);
  }
}

export async function POST(request: Request) {
  const telemetry = getTelemetry();
  return observeRoute(request, route, async () => {
    const kapso = config();
    if (!kapso) return emptyResponse(404);
    try {
      const signature = request.headers.get("x-webhook-signature");
      if (!signature || !/^[a-f\d]{64}$/i.test(signature)) {
        telemetry.emit("auth.token.rejected", { attrs: { issuer: "kapso", reason: "signature" } });
        return emptyResponse(401);
      }
      const body = await readWebhookBody(request, 32_768);
      if (!body) return emptyResponse(413);
      if (!validSignature(body, signature, kapso.secret)) {
        telemetry.emit("auth.token.rejected", { attrs: { issuer: "kapso", reason: "signature" } });
        return emptyResponse(401);
      }
      telemetry.emit("auth.token.verified", { attrs: { issuer: "kapso" } });
      if (request.headers.get("x-webhook-event") !== inboundEvent) return emptyResponse(204);
      let json: unknown;
      try { json = JSON.parse(body.toString("utf8")); }
      catch (error) { return emptyResponse(400, telemetry.error(route, error)); }
      const message = parseMessage(json, kapso.numberId);
      if (!message) return emptyResponse(204);
      const store = whatsappStore();
      const linking = /^VINCULAR\b/i.test(message.text);
      // For routed messages Kapso receives its ACK after the turn and outbound send commit.
      const routed = !linking && isConversationInput(message.text) && !!process.env.ANTHROPIC_API_KEY?.trim();

      const deliver = async () => {
        const send = (text: string, userId?: string) => telemetry.span("whatsapp.send", { userId }, () =>
          sendText(kapso, message.phone, text));
        if (linking) {
          const code = /^VINCULAR\s+([a-f\d]{32})$/i.exec(message.text)?.[1];
          const userId = code ? await store.detect(code.toLowerCase(), message.phone) : undefined;
          telemetry.emit("whatsapp.link", { userId, attrs: { action: userId ? "detected" : "invalid_code" } });
          await send(userId
            ? "Número detectado. Vuelve a Sideband para confirmar el vínculo."
            : "Código usado, incorrecto o vencido. Genera otro desde Sideband.", userId);
          return;
        }
        const { phone, timestamp } = message;
        try {
          await store.registerChannel({ phone, timestamp }, registerNoticeChannel);
        } catch (error) {
          telemetry.error("whatsapp.channel", error);
        }
        await flushPending(store, phone, timestamp, send);
        await store.whileLinked(message.phone, message.timestamp, async (userId, linkId) => {
          if (!userId) return send(`Vincula tu WhatsApp desde Sideband: ${kapso.connectUrl}`);
          await telemetry.context({ userId }, async () => {
            let requestId: string | undefined;
            let answer: string;
            try {
              const owner = { userId };
              const broker = ownerClient();
              const flow = routed ? whatsappMessageRuntime() : undefined;
              if (routed && (!flow || !linkId)) throw new Error("El vínculo del turno aún no está disponible.");
              const onResult = (action: "ask" | "status", view: RequesterView) => {
                requestId = view.requestId;
                telemetry.emit("whatsapp.request", { requestId, attrs: { action, decision: view.decision, tool: view.tool } });
              };
              answer = await runCommand(broker, owner, message.text, onResult,
                flow && linkId ? whatsappMessage(flow, broker, owner, linkId, message, onResult) : undefined);
            } catch (error) {
              if (routed && (!(error instanceof BrokerError) || error.code === "internal" || error.code === "rate_limited")) throw error;
              const errorId = telemetry.error("whatsapp.command", error);
              answer = error instanceof BrokerError && error.code === "rate_limited"
                ? "Llegaste al límite de solicitudes. Intenta en un momento."
                : `No pude completar la consulta. Revisa «estado» antes de reenviarla. Referencia: ${errorId}`;
            }
            await telemetry.context({ requestId }, () => send(answer, userId));
          });
        }, routed ? { numberId: kapso.numberId, messageId: message.id } : undefined);
      };
      if (routed) await deliver();
      else if (await store.claim(kapso.numberId, message.id)) {
        after(() => deliver().catch(error => { telemetry.error("whatsapp.delivery", error); }));
      }
      return emptyResponse(200);
    } catch (error) {
      return emptyResponse(503, telemetry.error(route, error));
    }
  });
}
