import { BrokerError, type OwnerPort } from "@team-31/broker/client";
import { Address, AskInput, type Category, type Owner, type RequesterView } from "@team-31/protocol";
import { describeSharing } from "../../app/(app)/contacts/describe";
import type { InterpretMessage } from "./claude";

export const askExample = "Pregunta a carla@sideband.app si puede jugar el sábado";
const askHelp = `Prueba: «${askExample}», escribe «estado» para revisar tu última solicitud enviada o «contactos» para ver tu agenda.`;
type WhatsAppBroker = Pick<OwnerPort, "ask" | "status" | "activity" | "contacts">;

const words = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";

async function resolveRecipient(broker: WhatsAppBroker, owner: Owner, text: string, reference: string) {
  const addresses = [...new Set((text.toLowerCase().match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}(?![\w-]|\.[\w.-])/g) ?? [])
    .filter((candidate) => Address.safeParse(candidate).success))];
  const explicit = Address.safeParse(reference.trim().toLowerCase());
  if (addresses.length || explicit.success) {
    return explicit.success && addresses.length === 1 && addresses[0] === explicit.data ? explicit.data : undefined;
  }
  const name = words(reference);
  if (!name || !` ${words(text)} `.includes(` ${name} `)) return;
  const { contacts } = await broker.contacts(owner);
  const matches = contacts.map(({ address }) => address)
    .filter((address) => ` ${words(address.split("@")[0] ?? "")} `.includes(` ${name} `));
  return matches.length === 1 ? matches[0] : undefined;
}

export function summarize(view: RequesterView): string {
  const reference = `\n\nSolicitud: ${view.requestId}`;
  if (view.decision === "deny") return "No se pudo compartir una respuesta a esta solicitud." + reference;
  if (view.decision === "pending") {
    return view.waitingFor === "owner"
      ? `Le pregunté a ${view.to}. Espera su aprobación; te aviso apenas responda.`
      : `Le pregunté a ${view.to}. Te aviso apenas responda.`;
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
  broker: WhatsAppBroker, owner: Owner, text: string,
  onResult: (action: "ask" | "status", view: RequesterView) => void,
  interpret?: InterpretMessage,
): Promise<string> {
  const status = /^\/?estado(?:\s+([a-f0-9-]{36}))?$/i.exec(text);
  async function readStatus(id?: string, to?: string) {
    id ??= (await broker.activity(owner, 100))
      .find((item) => item.direction === "sent" && (!to || item.to === to))?.requestId;
    if (!id) return to ? `No encontré solicitudes recientes a ${to}.` : "No encontré solicitudes recientes enviadas desde tu cuenta.";
    try {
      const view = await broker.status(owner, id);
      onResult("status", view);
      return summarize(view);
    } catch (error) {
      if (error instanceof BrokerError && error.code === "not_found") return "No encontré esa solicitud en tu cuenta.";
      throw error;
    }
  }

  async function listContacts() {
    const { contacts } = await broker.contacts(owner);
    if (!contacts.length) return "Aún no tienes contactos. Conecta con alguien desde Sideband para poder preguntarle.";
    const lines = contacts.map(({ address, receives }) => `• ${address}: te comparte ${describeSharing(receives)}`);
    return `Tus contactos:\n${lines.join("\n")}`;
  }

  async function ask(to: string, question: string, category: Category) {
    const input = AskInput.safeParse({ to, tool: "question", args: { text: question, category } });
    if (!input.success) return `Incluye una dirección Sideband y una pregunta de hasta 1000 caracteres. ${askHelp}`;
    const view = await broker.ask(owner, input.data, "whatsapp");
    onResult("ask", view);
    return summarize(view);
  }

  if (status || /^¿?\s*ya respondi[oó]\s*\??$/i.test(text)) return readStatus(status?.[1]);
  if (/^\/?contactos$/i.test(text)) return listContacts();
  const match = /^(?:\/pregunta\s+|preg[uú]nta(?:le)?\s+a\s+)(\S+?)(?::\s*|\s+)(\S[\s\S]*)$/i.exec(text);
  const explicit = Address.safeParse(match?.[1]?.toLowerCase());
  const command = explicit.success && match?.[2] ? { to: explicit.data, question: match[2] } : undefined;
  if (!interpret && command) return ask(command.to, command.question, "general");
  if (!interpret) return askHelp;
  if ((command?.question ?? text).length > 1000) return "Escribe una pregunta de hasta 1000 caracteres.";
  if (!text) return askHelp;

  const intent = await interpret(text);
  const clarifyCategory = "No pude identificar una sola categoría. Reformula el mensaje con una pregunta sobre un solo tema.";
  if (command) {
    return intent.action === "ask" && intent.category ? ask(command.to, command.question, intent.category) : clarifyCategory;
  }
  if (intent.action === "help") return "Puedo preguntarle algo a un contacto, revisar si ya te respondió o mostrarte tus contactos.";
  if (intent.action === "contacts") return listContacts();
  if (intent.action === "status" && !intent.recipient) return readStatus();
  const to = intent.recipient ? await resolveRecipient(broker, owner, text, intent.recipient) : undefined;
  if (!to) return "No pude identificar a una sola persona. Repite tu mensaje con su dirección Sideband completa.";
  // Do not let the model invent or rewrite what will be delivered to the other agent.
  if (intent.action === "status") return readStatus(undefined, to);
  return intent.category ? ask(to, text, intent.category) : clarifyCategory;
}
