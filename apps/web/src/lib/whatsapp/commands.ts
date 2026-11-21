import { BrokerError, type OwnerPort } from "@team-31/broker-client";
import { Address, AskInput, type Category, type Owner, type RequesterView } from "@team-31/protocol";
import { getTelemetry } from "../telemetry";
import { describeSharing } from "../../app/(app)/contacts/describe";
import type { InterpretMessage } from "./claude";

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

const sharingTerms = new Map<string, Category>([
  ["disponibilidad", "availability"], ["disponibilidad horaria", "availability"], ["intereses", "interests"],
  ["salud", "health"], ["preguntas abiertas", "general"], ["general", "general"],
]);

async function acceptInvitation(broker: WhatsAppBroker, owner: Owner, text: string) {
  const help = "¿Qué quieres compartir? Escribe «acepta a nombre@sideband.app y compártele disponibilidad, intereses, salud, preguntas abiertas o nada», usando solo las opciones que elijas.";
  const match = /^acepta a (\S+?)(?: y comp[aá]rtele (?:solo )?(.+?))?[.!]?$/iu.exec(text);
  if (!match?.[1] || !match[2]) return help;
  const terms = match[2].toLowerCase().split(/\s*,\s*|\s+y\s+/u);
  const share: Category[] = [];
  if (match[2].toLowerCase() !== "nada") {
    for (const term of terms) {
      const category = sharingTerms.get(term);
      if (!category) return help;
      if (!share.includes(category)) share.push(category);
    }
  }
  const ref = match[1].toLowerCase();
  const matches = (await broker.contacts(owner)).incoming.filter(({ address }) =>
    ref.includes("@") ? address === ref : words(address.split("@")[0]!) === words(ref));
  if (!matches.length) return "No encontré una invitación pendiente de esa persona. Revisa su dirección Sideband.";
  if (matches.length !== 1) return "Hay más de una coincidencia. Repite el mensaje con la dirección Sideband completa.";
  const invitation = matches[0]!;
  await broker.answerInvitation(owner, invitation.requestId, { accept: true, share });
  return `Aceptaste a ${invitation.address}. Le compartes: ${describeSharing(share)}.`;
}

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
  return `Respuesta de ${view.to}:\n${formatAnswer(view.result)}`;
}

function formatAnswer(result: Extract<RequesterView, { decision: "allow" }>["result"]) {
  if ("answer" in result) return result.answer;
  if ("matches" in result) return result.matches ? "Sí, coincide." : "No coincide.";
  if ("available" in result) {
    const slots = result.freeSlots?.length ? ` Horarios: ${result.freeSlots.join(", ")}.` : "";
    return (result.available ? "Disponible." : "No disponible.") + slots;
  }
  if ("accepted" in result) return result.accepted ? "Aceptó la solicitud de conexión." : "No aceptó la solicitud de conexión.";
  return [result.displayName, result.headline].filter(Boolean).join(" — ");
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
    if (view.decision !== "deny") return summarize(view);
    // The broker denies without a reason. What the contact shares is already in the owner's own
    // contacts view, so naming the missing category reveals nothing new.
    let contacts;
    try {
      ({ contacts } = await broker.contacts(owner));
    } catch (error) {
      getTelemetry().error("whatsapp.denial.contacts", error, { userId: owner.userId, requestId: view.requestId });
      return summarize(view);
    }
    const contact = contacts.find(({ address }) => address === to);
    if (!contact) return `${to} no está entre tus contactos.`;
    if (!contact.receives.includes(category)) return `${to} no te comparte ${notShared[category]}.`;
    return summarize(view);
  }

  if (status || /^¿?\s*ya respondi[oó]\s*\??$/i.test(text)) return readStatus(status?.[1]);
  if (/^\/?contactos$/i.test(text)) return listContacts();
  if (/^acepta\b/iu.test(text)) return acceptInvitation(broker, owner, text);
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
