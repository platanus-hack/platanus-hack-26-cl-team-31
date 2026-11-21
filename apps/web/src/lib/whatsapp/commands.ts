import { BrokerError, type OwnerPort } from "@team-31/broker/client";
import { AskInput, type Owner, type RequesterView } from "@team-31/protocol";

export const askExample = "Pregunta a carla@nexo.app si puede jugar el sábado";
const askHelp = `Prueba: «${askExample}» o escribe «estado» para revisar tu última solicitud enviada.`;

function summarize(view: RequesterView): string {
  const reference = `\n\nSolicitud: ${view.requestId}`;
  if (view.decision === "deny") return "No se pudo compartir una respuesta a esta solicitud." + reference;
  if (view.decision === "pending") {
    return `Solicitud a ${view.to} pendiente ${view.waitingFor === "owner" ? "de aprobación" : "de respuesta"}.` + reference;
  }
  if (view.decision === "unanswered") {
    return { no_data: "No hay datos para responder.", expired: "La solicitud venció.",
      delivery_failed: "No se pudo entregar la solicitud." }[view.outcome] + reference;
  }
  const result = view.result;
  const answer = "answer" in result ? result.answer :
    "matches" in result ? result.matches ? "Sí, coincide." : "No coincide." :
    "available" in result ? `${result.available ? "Disponible." : "No disponible."}${result.freeSlots?.length ? ` Horarios: ${result.freeSlots.join(", ")}.` : ""}` :
    "accepted" in result ? result.accepted ? "Aceptó la solicitud de conexión." : "No aceptó la solicitud de conexión." :
    [result.displayName, result.headline].filter(Boolean).join(" — ");
  return `Respuesta de ${view.to}:\n${answer}` + reference;
}

export async function runCommand(
  broker: Pick<OwnerPort, "ask" | "status" | "activity">, owner: Owner, text: string,
  onResult: (action: "ask" | "status", view: RequesterView) => void,
): Promise<string> {
  const status = /^\/?estado(?:\s+([a-f0-9-]{36}))?$/i.exec(text);
  if (status || /^¿?\s*ya respondi[oó]\s*\??$/i.test(text)) {
    const id = status?.[1] ?? (await broker.activity(owner, 100)).find((item) => item.direction === "sent")?.requestId;
    if (!id) return "No encontré solicitudes recientes enviadas desde tu cuenta.";
    try {
      const view = await broker.status(owner, id);
      onResult("status", view);
      return summarize(view);
    } catch (error) {
      if (error instanceof BrokerError && error.code === "not_found") return "No encontré esa solicitud en tu cuenta.";
      throw error;
    }
  }
  const match = /^(?:\/pregunta\s+|preg[uú]nta(?:le)?\s+a\s+)(\S+?)(?::\s*|\s+)(\S[\s\S]*)$/i.exec(text);
  if (!match) return askHelp;
  const input = AskInput.safeParse({ to: match[1].toLowerCase(), tool: "question", args: { text: match[2] } });
  if (!input.success) return `Incluye una dirección Nexo y una pregunta de hasta 1000 caracteres. ${askHelp}`;
  const view = await broker.ask(owner, input.data);
  onResult("ask", view);
  return summarize(view);
}
