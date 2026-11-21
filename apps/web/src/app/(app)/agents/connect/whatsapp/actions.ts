"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { setChannel } from "@/lib/whatsapp/channel";
import { config, noticeTarget } from "@/lib/whatsapp/kapso";
import { getTelemetry } from "@/lib/telemetry";
import { whatsappStore } from "@/lib/whatsapp/runtime";
import { getOwner, requireAddress } from "../../../owner";

type Feedback = { code?: string; link?: string; qr?: string; error?: string; message?: string };
const path = "/agents/connect/whatsapp";

export async function updatePhone(_: Feedback, form: FormData): Promise<Feedback> {
  const { userId } = await getOwner();
  await requireAddress();
  const action = form.get("action");
  const telemetry = getTelemetry();
  try {
    const store = whatsappStore();
    if (action === "unlink") {
      await store.unlink(userId);
      await setChannel(userId, { kind: "none" });
      telemetry.emit("whatsapp.link", { userId, attrs: { action: "unlinked" } });
      revalidatePath(path);
      return { message: "WhatsApp desvinculado." };
    }
    const kapso = config();
    if (!kapso) return { error: "WhatsApp aún no está disponible." };
    if (action === "start") {
      const code = await store.start(userId);
      if (!code) return { error: "Tu cuenta ya tiene un número registrado." };
      telemetry.emit("whatsapp.link", { userId, attrs: { action: "started" } });
      revalidatePath(path);
      const link = `https://wa.me/${kapso.number.slice(1)}?text=${encodeURIComponent(`VINCULAR ${code}`)}`;
      return { code, link, qr: await QRCode.toDataURL(link, { margin: 1, width: 320 }) };
    }
    const id = form.get("id");
    if (action === "confirm" && typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)) {
      const linkId = await store.confirm(userId, id);
      if (!linkId) return { error: "El vínculo venció o cambió. Genera otro código." };
      const target = noticeTarget(linkId);
      if (target) await setChannel(userId, target);
      telemetry.emit("whatsapp.link", { userId, attrs: { action: "confirmed" } });
      revalidatePath(path);
      return { message: "WhatsApp vinculado." };
    }
    return { error: "Acción no válida." };
  } catch (error) {
    const errorId = telemetry.error("whatsapp.link", error, { userId });
    if ((error as { code?: string } | null)?.code === "23505") {
      return { error: "Ese número ya está vinculado a otra cuenta." };
    }
    return { error: `No se pudo actualizar WhatsApp. Referencia: ${errorId}` };
  }
}
