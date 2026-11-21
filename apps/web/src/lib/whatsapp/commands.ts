import { BrokerError, type OwnerPort } from "@team-31/broker/client";
import { Address, AskInput, type Category, type Owner, type RequesterView } from "@team-31/protocol";
import { describeSharing } from "../../app/(app)/contacts/describe";
import { parseSharingCategories, type MessageReply } from "@team-31/message-flow";

// What a denial means when the contact does not share the category asked about.
const notShared: Record<Category, string> = {
  availability: "su disponibilidad horaria",
  interests: "sus intereses",
  health: "su información de salud",
  general: "respuestas a preguntas abiertas",
};

export const askExample = "Pregunta a carla@sideband.app si puede jugar el sábado";
const askHelp = `Prueba: «${askExample}», escribe «estado» para revisar tu última solicitud enviada o «contactos» para ver tu agenda.`;
type WhatsAppBroker = Pick<OwnerPort, "ask" | "status" | "activity" | "contacts" | "answerInvitation">;

const words = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";

async function acceptInvitation(broker: WhatsAppBroker, owner: Owner, text: string) {
  const help = "¿Qué quieres compartir? Escribe «acepta a nombre@sideband.app y compártele disponibilidad, intereses, salud, preguntas abiertas o nada», usando solo las opciones que elijas.";
  const match = /^acepta a (\S+?)(?: y comp[aá]rtele (?:solo )?(.+?))?[.!]?$/iu.exec(text);
  if (!match?.[1] || !match[2]) return help;
  const share = parseSharingCategories(match[2]);
  if (!share) return help;
  const ref = match[1].toLowerCase();
  const matches = (await broker.contacts(owner)).incoming.filter(({ address }) =>
    ref.includes("@") ? address === ref : words(address.split("@")[0]!) === words(ref));
  if (!matches.length) return "No encontré una invitación pendiente de esa persona. Revisa su dirección Sideband.";
  if (matches.length !== 1) return "Hay más de una coincidencia. Repite el mensaje con la dirección Sideband completa.";
  const invitation = matches[0]!;
  await broker.answerInvitation(owner, invitation.requestId, { accept: true, share });
  return `Aceptaste a ${invitation.address}. Le compartes: ${describeSharing(share)}.`;
}

export function summarize(view: RequesterView): string {
  if (view.decision === "deny") return `No se pudo obtener una respuesta de ${view.to}.`;
  if (view.decision === "pending") {
    return view.waitingFor === "owner"
      ? `Le pregunté a ${view.to}. Espera su aprobación; te aviso apenas responda.`
      : `Le pregunté a ${view.to}. Te aviso apenas responda.`;
  }
  if (view.decision === "unanswered") {
    return { no_data: `${view.to} no tiene datos para responder eso.`, expired: `Tu pregunta a ${view.to} venció sin respuesta.`,
      delivery_failed: `No se pudo entregar tu pregunta a ${view.to}.` }[view.outcome];
  }
  const result = view.result;
  const answer = "answer" in result ? result.answer :
    "matches" in result ? result.matches ? "Sí, coincide." : "No coincide." :
    "available" in result ? `${result.available ? "Disponible." : "No disponible."}${result.freeSlots?.length ? ` Horarios: ${result.freeSlots.join(", ")}.` : ""}` :
    "accepted" in result ? result.accepted ? "Aceptó la solicitud de conexión." : "No aceptó la solicitud de conexión." :
    [result.displayName, result.headline].filter(Boolean).join(" — ");
  return `Respuesta de ${view.to}:\n${answer}`;
}

const statusCommand = /^\/?estado(?:\s+([a-f0-9-]{36}))?$/i;
const contactsCommand = /^\/?contactos$/iu;
const acceptCommand = /^acepta\b/iu;

export function isConversationInput(text: string): boolean {
  return !!text && !statusCommand.test(text) && !contactsCommand.test(text) && !acceptCommand.test(text);
}

export async function runCommand(
  broker: WhatsAppBroker, owner: Owner, text: string,
  onResult: (action: "ask" | "status", view: RequesterView) => void,
  messageFlow?: (text: string) => Promise<MessageReply>,
): Promise<string> {
  const status = statusCommand.exec(text);
  async function readStatus(id?: string) {
    id ??= (await broker.activity(owner, 100))
      .find((item) => item.direction === "sent")?.requestId;
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

  async function listContacts() {
    const { contacts } = await broker.contacts(owner);
    return contactsText(contacts);
  }

  async function ask(to: string, question: string, category: Category) {
    const input = AskInput.safeParse({ to, tool: "question", args: { text: question, category } });
    if (!input.success) return `Incluye una dirección Sideband y una pregunta de hasta 1000 caracteres. ${askHelp}`;
    const view = await broker.ask(owner, input.data, "whatsapp");
    onResult("ask", view);
    if (view.decision !== "deny") return summarize(view);
    // The broker denies without a reason. What the contact shares is already in the owner's own
    // contacts view, so naming the missing category reveals nothing new.
    const contact = (await broker.contacts(owner)).contacts.find(({ address }) => address === to);
    if (!contact) return `${to} no está entre tus contactos.`;
    if (!contact.receives.includes(category)) return `${to} no te comparte ${notShared[category]}.`;
    return summarize(view);
  }

  if (status || !messageFlow && /^¿?\s*ya respondi[oó]\s*\??$/i.test(text)) return readStatus(status?.[1]);
  if (contactsCommand.test(text)) return listContacts();
  if (acceptCommand.test(text)) return acceptInvitation(broker, owner, text);
  if (messageFlow && text) return formatMessageReply(await messageFlow(text));
  const match = /^(?:\/pregunta\s+|preg[uú]nta(?:le)?\s+a\s+)(\S+?)(?::\s*|\s+)(\S[\s\S]*)$/i.exec(text);
  const explicit = Address.safeParse(match?.[1]?.toLowerCase());
  const command = explicit.success && match?.[2] ? { to: explicit.data, question: match[2] } : undefined;
  return command ? ask(command.to, command.question, "general") : askHelp;
}

function contactsText(contacts: { address: string; receives: Category[] }[]): string {
  if (!contacts.length) return "Aún no tienes contactos. Conecta con alguien desde Sideband para poder preguntarle.";
  return ["Tus contactos:", ...contacts.map(({ address, receives }) => `• ${address}: te comparte ${describeSharing(receives)}`)].join("\n");
}

export function formatMessageReply(reply: MessageReply): string {
  switch (reply.kind) {
    case "clarification":
      return [reply.question, ...(reply.choices ?? []).map((choice, index) => `${index + 1}. ${choice.label}`)].join("\n");
    case "requests": {
      const lines = reply.items.map(summarize);
      if (reply.unconfirmedCount) lines.push(`Quedan ${reply.unconfirmedCount} envíos por confirmar. Escribe «continuar» para retomarlos.`);
      return lines.join("\n");
    }
    case "contacts":
      return contactsText(reply.data.contacts.map(({ address, theyShare }) => ({ address, receives: theyShare })));
    case "profiles":
      return reply.items.map(p => [`${p.displayName} (${p.address})`, p.headline].filter(Boolean).join(" — ")).join("\n") || "No encontré perfiles públicos con ese nombre.";
    case "vault":
      return reply.data.categories.map(c => [c.name, ...(c.entries ?? []).map(e => `• ${e.label}: ${e.value}`)].join("\n")).join("\n") || "No encontré categorías compartidas para esa consulta.";
    case "unavailable":
      return { expired: "Ese turno venció. Vuelve a escribir tu petición.", unsupported: "Esa operación no está disponible.", empty_selection: "No encontré destinatarios para esa consulta." }[reply.reason];
  }
}
