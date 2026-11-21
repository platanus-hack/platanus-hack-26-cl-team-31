import { BrokerError, type OwnerPort } from "@team-31/broker-client";
import { Address, AskInput, type Category, type Owner, type RequesterView, type VaultCatalog } from "@team-31/protocol";
import { getTelemetry } from "../telemetry";
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
const askHelp = `Prueba: «${askExample}», escribe «estado» para revisar tu última solicitud enviada, «contactos» para ver tu agenda o «bóvedas» para ver lo que guardas.`;
type WhatsAppBroker = Pick<OwnerPort, "ask" | "status" | "activity" | "contacts" | "answerInvitation" | "vault">;

const words = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";

function parseAcceptance(text: string) {
  const match = /^acepta a (\S+?)(?: y comp[aá]rtele (?:solo )?(.+?))?[.!]?$/iu.exec(text);
  if (!match?.[1] || !match[2]) return;
  const share = parseSharingCategories(match[2]);
  if (share) return { ref: match[1].toLowerCase(), share };
}

async function acceptInvitation(broker: WhatsAppBroker, owner: Owner, text: string) {
  const acceptance = parseAcceptance(text);
  if (!acceptance) return "¿Qué quieres compartir? Escribe «acepta a nombre@sideband.app y compártele disponibilidad, intereses, salud, preguntas abiertas o nada», usando solo las opciones que elijas.";
  const { ref, share } = acceptance;
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

const statusCommand = /^\/?estado(?:\s+([a-f0-9-]{36}))?$/i;
const contactsCommand = /^\/?contactos$/iu;
const acceptCommand = /^acepta\b/iu;
// «bóvedas» lists the holder's own categories; «bóveda Salud» opens one.
const vaultCommand = /^\/?b[oó]vedas?(?:\s+(\S.*?))?[.?!]*$/iu;

export function isConversationInput(text: string): boolean {
  return !!text && !statusCommand.test(text) && !contactsCommand.test(text) && !acceptCommand.test(text) && !vaultCommand.test(text);
}

type ReportResult = (action: "ask" | "status", view: RequesterView) => void;

async function readStatus(broker: WhatsAppBroker, owner: Owner, onResult: ReportResult, id?: string) {
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

const explicitQuestion = /^(?:\/pregunta\s+|preg[uú]nta(?:le)?\s+a\s+)(\S+?)(?::\s*|\s+)(\S[\s\S]*)$/i;

async function askExplicitQuestion(broker: WhatsAppBroker, owner: Owner, onResult: ReportResult, text: string) {
  const match = explicitQuestion.exec(text);
  if (!match?.[2]) return askHelp;
  const address = Address.safeParse(match[1]?.toLowerCase());
  if (!address.success) return askHelp;
  const to = address.data;
  const category = "general";
  const input = AskInput.safeParse({ to, tool: "question", args: { text: match[2], category } });
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

export async function runCommand(
  broker: WhatsAppBroker, owner: Owner, text: string, onResult: ReportResult,
  messageFlow?: (text: string) => Promise<MessageReply>,
): Promise<string> {
  const status = statusCommand.exec(text);
  if (status) return readStatus(broker, owner, onResult, status[1]);
  if (contactsCommand.test(text)) return contactsText((await broker.contacts(owner)).contacts);
  const vault = vaultCommand.exec(text);
  if (vault) {
    const name = vault[1];
    const { categories } = await broker.vault(owner);
    if (!name) return vaultListText(categories);
    const matches = categories.filter(c => words(c.name) === words(name));
    return matches.length ? openedVaultText(matches) : `No tienes una bóveda llamada «${name}». Escribe «bóvedas» para verlas.`;
  }
  if (acceptCommand.test(text)) return acceptInvitation(broker, owner, text);
  if (messageFlow && text) return formatMessageReply(await messageFlow(text));
  if (/^¿?\s*ya respondi[oó]\s*\??$/i.test(text)) return readStatus(broker, owner, onResult);
  return askExplicitQuestion(broker, owner, onResult, text);
}

function contactsText(contacts: { address: string; receives: Category[] }[]): string {
  if (!contacts.length) return "Aún no tienes contactos. Conecta con alguien desde Sideband para poder preguntarle.";
  return ["Tus contactos:", ...contacts.map(({ address, receives }) => `• ${address}: te comparte ${describeSharing(receives)}`)].join("\n");
}

type OwnCategory = VaultCatalog["categories"][number];
const vaultTitle = (c: OwnCategory) => `${c.name}${c.visibility === "public" ? " (pública)" : ""}: ${c.description ?? "sin descripción"}`;

function vaultListText(categories: OwnCategory[]): string {
  if (!categories.length) return "Tu bóveda no tiene categorías. Créalas desde Mi bóveda en Sideband.";
  return ["Tus bóvedas:", ...categories.map(c => `• ${vaultTitle(c)}`), "Escribe «bóveda» y un nombre para ver lo que guarda."].join("\n");
}

function openedVaultText(categories: OwnCategory[]): string {
  return categories.map(c => [vaultTitle(c), ...(c.entries?.length ? c.entries.map(e => `• ${e.label}: ${e.value}`) : ["Aún no guarda datos."])].join("\n")).join("\n\n");
}

function requestRepliesText(reply: Extract<MessageReply, { kind: "requests" }>): string {
  const lines = reply.items.map(summarize);
  for (const ref of reply.confirmed ?? []) lines.push(`Solicitud confirmada para ${ref.to}. ID ${ref.requestId}.`);
  if (reply.unconfirmedCount) lines.push(`Quedan ${reply.unconfirmedCount} envíos por confirmar. Escribe «continuar» para retomarlos.`);
  return lines.join("\n");
}

export function formatMessageReply(reply: MessageReply): string {
  switch (reply.kind) {
    case "clarification":
      return [reply.question, ...(reply.choices ?? []).map((choice, index) => `${index + 1}. ${choice.label}`)].join("\n");
    case "requests":
      return requestRepliesText(reply);
    case "contacts":
      return contactsText(reply.data.contacts.map(({ address, theyShare }) => ({ address, receives: theyShare })));
    case "profiles":
      return reply.items.map(p => [`${p.displayName} (${p.address})`, p.headline].filter(Boolean).join(" — ")).join("\n") || "No encontré perfiles públicos con ese nombre.";
    case "vault":
      return reply.data.categories.map(c => [
        `${c.name}${c.description ? `: ${c.description}` : ""}${c.canRead ? "" : " (sin acceso)"}`,
        ...(c.entries ?? []).map(e => `• ${e.label}: ${e.value}`),
      ].join("\n")).join("\n") || "No encontré categorías para esa consulta.";
    case "own_vault": {
      // Entries come only for an opened category.
      const { categories } = reply.data;
      return categories.length && categories.every(c => c.entries) ? openedVaultText(categories) : vaultListText(categories);
    }
    case "unavailable":
      return { expired: "Ese turno venció. Vuelve a escribir tu petición.", unsupported: "Esa operación no está disponible.", empty_selection: "No encontré destinatarios para esa consulta." }[reply.reason];
  }
}
