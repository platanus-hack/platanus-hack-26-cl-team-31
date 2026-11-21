import { after } from "next/server";
import { BrokerError } from "@team-31/broker/client";
import { ownerClient } from "../../../../lib/broker";
import { getTelemetry, observeRoute } from "../../../../lib/telemetry";
import { claudeInterpreter } from "../../../../lib/whatsapp/claude";
import { runCommand } from "../../../../lib/whatsapp/commands";
import { noticeText } from "../../../../lib/whatsapp/delivery";
import { config, inboundEvent, parseMessage, sendText, validSignature } from "../../../../lib/whatsapp/kapso";
import { whatsappStore } from "../../../../lib/whatsapp/runtime";

const route = "/api/kapso/webhook";

export async function POST(request: Request) {
  const kapso = config();
  if (!kapso) return new Response(null, { status: 404 });
  const telemetry = getTelemetry();
  return observeRoute(request, route, async () => {
    const reply = (status: number, errorId?: string) =>
      new Response(null, { status, headers: errorId ? { "X-Error-Id": errorId } : undefined });
    try {
      const signature = request.headers.get("x-webhook-signature");
      if (!signature || !/^[a-f\d]{64}$/i.test(signature)) {
        telemetry.emit("auth.token.rejected", { attrs: { issuer: "kapso", reason: "signature" } });
        return reply(401);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (request.body) {
        for await (const chunk of request.body as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > 32_768) return reply(413);
          chunks.push(chunk);
        }
      }
      const body = Buffer.concat(chunks);
      if (!validSignature(body, signature, kapso.secret)) {
        telemetry.emit("auth.token.rejected", { attrs: { issuer: "kapso", reason: "signature" } });
        return reply(401);
      }
      telemetry.emit("auth.token.verified", { attrs: { issuer: "kapso" } });
      if (request.headers.get("x-webhook-event") !== inboundEvent) return reply(204);
      let json: unknown;
      try { json = JSON.parse(body.toString("utf8")); }
      catch (error) { return reply(400, telemetry.error(route, error)); }
      const message = parseMessage(json, kapso.numberId);
      if (!message) return reply(204);
      const store = whatsappStore();
      if (!await store.claim(kapso.numberId, message.id)) return reply(200);

      after(async () => {
        const send = (text: string, userId?: string) => telemetry.span("whatsapp.send", { userId }, () =>
          sendText(kapso, message.phone, text));
        try {
          if (/^VINCULAR\b/i.test(message.text)) {
            const code = /^VINCULAR\s+([a-f\d]{32})$/i.exec(message.text)?.[1];
            const userId = code ? await store.detect(code.toLowerCase(), message.phone) : undefined;
            telemetry.emit("whatsapp.link", { userId, attrs: { action: userId ? "detected" : "invalid_code" } });
            await send(userId
              ? "Número detectado. Vuelve a Sideband para confirmar el vínculo."
              : "Código usado, incorrecto o vencido. Genera otro desde Sideband.", userId);
            return;
          }
          await store.whileLinked(message.phone, message.timestamp, async (userId) => {
            if (!userId) return send(`Vincula tu WhatsApp desde Sideband: ${kapso.connectUrl}`);
            await telemetry.context({ userId }, async () => {
              // Replies that missed the 24-hour window go out first, now that the owner wrote again.
              for (const pendingId of await store.pending(userId)) {
                const view = await ownerClient().status({ userId }, pendingId);
                const text = noticeText(view);
                if (text) await send(text, userId);
                await store.clearPending(userId, pendingId);
                telemetry.emit("whatsapp.delivery", { requestId: pendingId, attrs: { state: "flushed", decision: view.decision } });
              }
              let requestId: string | undefined;
              let answer: string;
              try {
                const interpret = claudeInterpreter();
                answer = await runCommand(ownerClient(), { userId }, message.text, (action, view) => {
                  requestId = view.requestId;
                  telemetry.emit("whatsapp.request", { requestId, attrs: { action, decision: view.decision, tool: view.tool } });
                }, interpret && ((text) => telemetry.span("whatsapp.interpret", {}, async (span) => {
                  const intent = await interpret(text);
                  span.set({ action: intent.action, category: intent.action === "ask" ? intent.category ?? undefined : undefined });
                  return intent;
                })));
              } catch (error) {
                const errorId = telemetry.error("whatsapp.command", error);
                answer = error instanceof BrokerError && error.code === "rate_limited"
                  ? "Llegaste al límite de solicitudes. Intenta en un momento."
                  : `No pude completar la consulta. Revisa «estado» antes de reenviarla. Referencia: ${errorId}`;
              }
              await telemetry.context({ requestId }, () => send(answer, userId));
            });
          });
        } catch (error) {
          telemetry.error("whatsapp.delivery", error);
        }
      });
      return reply(200);
    } catch (error) {
      return reply(503, telemetry.error(route, error));
    }
  });
}
