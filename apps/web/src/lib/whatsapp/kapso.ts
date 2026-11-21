import { createHmac, timingSafeEqual } from "node:crypto";

export const inboundEvent = "whatsapp.message.received";
export const e164 = /^\+[1-9]\d{7,14}$/;

export function config() {
  const { KAPSO_API_KEY: apiKey, KAPSO_PHONE_NUMBER_ID: numberId, KAPSO_WHATSAPP_NUMBER: number,
    KAPSO_WEBHOOK_SECRET: secret, BETTER_AUTH_URL: webUrl } = process.env;
  if (!apiKey || !numberId || !/^[\w-]{1,80}$/.test(numberId) || !number ||
      !e164.test(number) || !secret || secret.length < 16 || !webUrl) return;
  return { apiKey, numberId, number, secret, connectUrl: new URL("/agents/connect/whatsapp", webUrl).href };
}

export function validSignature(body: Buffer, signature: string | null, secret: string) {
  if (!signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), createHmac("sha256", secret).update(body).digest());
}

type Message = { id: string; phone: string; text: string; timestamp: number };

export function parseMessage(input: unknown, numberId: string, now = Date.now()): Message | undefined {
  if (typeof input !== "object" || input === null) return;
  const { phone_number_id, message } = input as {
    phone_number_id?: unknown;
    message?: { id?: unknown; from?: unknown; timestamp?: unknown; type?: unknown; text?: { body?: unknown };
      kapso?: { direction?: unknown; passive?: unknown; origin?: unknown } };
  };
  if (phone_number_id !== numberId || message?.type !== "text" || message.kapso?.direction !== "inbound" ||
      message.kapso.passive === true || message.kapso.origin === "history_sync" ||
      typeof message.id !== "string" || !message.id || message.id.length > 512 ||
      typeof message.from !== "string" || typeof message.timestamp !== "string" ||
      !/^\d{10}$/.test(message.timestamp) || typeof message.text?.body !== "string") return;
  const phone = "+" + message.from.replace(/^\+/, "");
  const timestamp = Number(message.timestamp);
  const age = now - timestamp * 1000;
  if (!e164.test(phone) || age > 86_400_000 || age < -60_000) return;
  return { id: message.id, phone, text: message.text.body.trim(), timestamp };
}

export async function sendText(kapso: NonNullable<ReturnType<typeof config>>, phone: string, text: string) {
  const response = await fetch(`https://api.kapso.ai/meta/whatsapp/v24.0/${kapso.numberId}/messages`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
    headers: { "X-API-Key": kapso.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone.slice(1), type: "text", text: {
      body: text.slice(0, 4096), preview_url: false,
    } }),
  });
  await response.body?.cancel();
  if (!response.ok) throw Object.assign(new Error("Kapso no aceptó el mensaje."), { code: `kapso_${response.status}` });
}
