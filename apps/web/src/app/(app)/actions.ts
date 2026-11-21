"use server";

import { BrokerError } from "@team-31/broker/client";
import { Address, CircleName, ContactTag, LocalPart, OwnerDecision, Sharing, ToolResultSchemas, type Owner } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ownerClient } from "@/lib/broker";
import { onboardingFlow, type OnboardingSource } from "@/lib/onboarding-flow";
import { getTelemetry, observeWebRequest } from "@/lib/telemetry";

import { getOwner, readAsOwner, requireAddress } from "./owner";
import { activityPageSize, parseActivityPage } from "./labels";

type Feedback = { error?: string; message?: string; errorId?: string };

// Domain errors become a message; anything else is recorded (without its message) before the fallback.
function actionError(operation: string, error: unknown, fallback: string) {
  if (!(error instanceof BrokerError) || error.code === "internal") {
    getTelemetry().error(`action ${operation}`, error);
    return fallback;
  }
  switch (error.code) {
    case "not_found": return "El elemento ya no está disponible.";
    case "expired": return "La solicitud venció.";
    case "conflict": return "La solicitud ya cambió. Actualiza la página.";
    case "rate_limited": return "Espera un momento antes de intentarlo de nuevo.";
    default: return fallback;
  }
}

export async function claimAddress(source: OnboardingSource, _: Feedback, form: FormData): Promise<Feedback> {
  const owner = await getOwner();
  const localPart = LocalPart.safeParse(form instanceof FormData ? form.get("localPart") : undefined);
  if (!localPart.success) {
    return { error: "Usa de 2 a 31 caracteres, con letras minúsculas, números, puntos, guiones o guiones bajos. Empieza con una letra o número." };
  }

  const flow = onboardingFlow(source);
  const feedback = await observeWebRequest("POST", "/onboarding", async (span) => {
    const telemetry = getTelemetry();
    telemetry.identify({ userId: owner.userId });
    try {
      await ownerClient().claimAddress(owner, localPart.data);
      if (flow.source === "invite") {
        telemetry.emit("web.invite.progress", { attrs: { step: "address_claimed" } });
      }
    } catch (error) {
      const errorId = telemetry.error("action claimAddress", error);
      span.setErrorId(errorId);
      const message = error instanceof BrokerError && error.code === "conflict"
        ? "Esa dirección ya está tomada"
        : actionError("claimAddress", error, "No se pudo guardar la dirección. Intenta de nuevo.");
      return { error: message, errorId };
    }
  });
  if (feedback) return feedback;

  revalidatePath("/", "layout");
  redirect(flow.destination);
}

export async function readHome() {
  const broker = ownerClient();
  const { data: [pending, activity, { incoming }] } = await readAsOwner((owner) =>
    Promise.all([broker.pending(owner), broker.activity(owner, 4), broker.contacts(owner)]));
  return [pending.filter((item) => item.tool !== "connect"), activity, incoming] as const;
}

export async function readActivity(input: unknown) {
  const page = parseActivityPage(input);
  const last = page * activityPageSize;
  const { data: items } = await readAsOwner((owner) => ownerClient().activity(owner, last + 1));
  return { items: items.slice(last - activityPageSize, last), hasNext: items.length > last };
}

export async function decide(requestId: string, _: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  if (!(form instanceof FormData)) return { error: "Elige una decisión válida." };
  const kind = form.get("decision");
  const validKind = kind === "approve_once" || kind === "deny" || kind === "yes" || kind === "no" || kind === "answer";
  if (!routes.ownerDecide.params.safeParse({ id: requestId }).success || !requestId || !validKind) {
    return { error: "Elige una decisión válida." };
  }

  try {
    const broker = ownerClient();
    const item = (await broker.pending(owner)).find((pending) => pending.requestId === requestId);
    if (!item) return { error: "Esta solicitud ya no está pendiente. Actualiza la página." };

    let decision: unknown = { kind };
    if (kind === "answer" && item.escalated && item.tool === "question") {
      const value = form.get("answer");
      const result = ToolResultSchemas.question.safeParse({ answer: typeof value === "string" ? value.trim() : value });
      if (!result.success) return { error: "Escribe una respuesta de entre 1 y 1000 caracteres." };
      decision = { kind: "answer", result: result.data };
    }
    if ((kind === "yes" || kind === "no") && item.escalated && item.tool === "availability") {
      decision = { kind: "answer", result: { available: kind === "yes" } };
    }
    if ((kind === "yes" || kind === "no") && item.escalated && item.tool === "interest_check") {
      decision = { kind: "answer", result: { matches: kind === "yes" } };
    }
    if ((kind === "yes" || kind === "no") && item.escalated && item.tool === "connect") {
      decision = { kind: "answer", result: { accepted: kind === "yes" } };
    }

    const parsed = OwnerDecision.safeParse(decision);
    if (!parsed.success || (kind === "approve_once" && item.escalated)) {
      return { error: "Esa decisión no está disponible para esta solicitud." };
    }
    await broker.decide(owner, requestId, parsed.data);
  } catch (error) {
    return { error: actionError("decide", error, "No se pudo registrar la decisión. Intenta de nuevo.") };
  }

  revalidatePath("/");
  revalidatePath("/activity");
  revalidatePath("/contacts");
  return { message: "Decisión guardada." };
}

export async function readAgents() {
  return (await readAsOwner((owner) => ownerClient().agents(owner))).data;
}

export async function pingOrRevokeAgent(agentId: string, _: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const operation = form instanceof FormData ? form.get("operation") : undefined;
  if (!routes.ownerPing.params.safeParse({ agentId }).success || !agentId || (operation !== "ping" && operation !== "revoke")) {
    return { error: "Elige una acción válida." };
  }

  try {
    if (operation === "ping") await ownerClient().ping(owner, agentId);
    else await ownerClient().revokeAgent(owner, agentId);
  } catch (error) {
    return { error: actionError("manageAgent", error, "No se pudo completar la acción. Intenta de nuevo.") };
  }
  revalidatePath("/agents");
  revalidatePath("/activity");
  revalidatePath("/");
  return { message: operation === "ping" ? "Prueba solicitada. Revisa su estado en Actividad." : "Agente desconectado." };
}

export async function readCircles() {
  const { address, data: circles } = await readAsOwner((owner) => ownerClient().circles(owner));
  return { address, circles };
}

async function changeCircle(operation: string, fallback: string, change: (owner: Owner) => Promise<unknown>): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  try {
    await change(owner);
  } catch (error) {
    return { error: actionError(operation, error, fallback) };
  }
  revalidatePath("/circles");
  revalidatePath("/agents");
  return {};
}

export async function createCircle(_: Feedback, form: FormData): Promise<Feedback> {
  const name = CircleName.safeParse(form instanceof FormData ? form.get("name") : undefined);
  if (!name.success) return { error: "Escribe un nombre de hasta 60 caracteres." };
  return changeCircle("createCircle", "No se pudo crear el círculo. Intenta de nuevo.",
    (owner) => ownerClient().createCircle(owner, name.data));
}

export async function inviteToCircle(circleId: string, _: Feedback, form: FormData): Promise<Feedback> {
  const address = Address.safeParse(form instanceof FormData ? String(form.get("address") ?? "").trim() : undefined);
  if (!address.success) return { error: "Ingresa una dirección válida, por ejemplo nombre@sideband.app." };
  return changeCircle("inviteToCircle", "No se pudo invitar a esa dirección. Intenta de nuevo.",
    (owner) => ownerClient().inviteToCircle(owner, circleId, address.data));
}

export async function joinCircle(circleId: string): Promise<Feedback> {
  return changeCircle("joinCircle", "No se pudo aceptar la invitación. Intenta de nuevo.",
    (owner) => ownerClient().joinCircle(owner, circleId));
}

// A member passes their own address to leave or decline. The creator passes someone else's.
export async function removeFromCircle(circleId: string, address: string): Promise<Feedback> {
  return changeCircle("removeFromCircle", "No se pudo completar la acción. Intenta de nuevo.",
    (owner) => ownerClient().removeFromCircle(owner, circleId, address));
}

export async function deleteCircle(circleId: string): Promise<Feedback> {
  return changeCircle("deleteCircle", "No se pudo eliminar el círculo. Intenta de nuevo.",
    (owner) => ownerClient().deleteCircle(owner, circleId));
}

export async function readContacts() {
  return (await readAsOwner((owner) => ownerClient().contacts(owner))).data;
}

function sharingFrom(form: FormData) {
  return Sharing.safeParse(form.getAll("category"));
}

function contactsChanged() {
  revalidatePath("/contacts");
  revalidatePath("/activity");
  revalidatePath("/");
}

export async function sendInvitation(_: Feedback, form: FormData): Promise<Feedback> {
  const address = await requireAddress();
  const owner = await getOwner();
  if (!(form instanceof FormData)) return { error: "Ingresa una dirección válida, por ejemplo nombre@sideband.app." };
  const to = Address.safeParse(String(form.get("to") ?? "").trim().toLowerCase());
  if (!to.success) return { error: "Ingresa una dirección válida, por ejemplo nombre@sideband.app." };
  if (to.data === address) return { error: "Esa es tu propia dirección." };
  const tag = ContactTag.safeParse(form.get("tag"));
  if (!tag.success) return { error: "Elige una etiqueta." };

  try {
    const view = await ownerClient().connect(owner, to.data, undefined, tag.data);
    contactsChanged();
    if (view.final && view.decision === "deny") return { error: "No encontramos a nadie con esa dirección." };
    if (view.final) return { message: `Ya estás conectado con ${to.data}.` };
  } catch (error) {
    if (error instanceof BrokerError && error.code === "invalid_input") return { error: error.message };
    return { error: actionError("sendInvitation", error, "No se pudo enviar la invitación. Intenta de nuevo.") };
  }
  return { message: `Invitación enviada a ${to.data}.` };
}

export async function answerInvitation(requestId: string, _: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  if (!(form instanceof FormData)) return { error: "Elige aceptar o rechazar." };
  const accept = form.get("answer") === "accept";
  const tag = ContactTag.safeParse(form.get("tag"));
  if (accept && !tag.success) return { error: "Elige una etiqueta." };

  try {
    await ownerClient().answerInvitation(owner, requestId, { accept, ...(accept && tag.success ? { tag: tag.data } : {}) });
  } catch (error) {
    return { error: actionError("answerInvitation", error, "No se pudo responder la invitación. Intenta de nuevo.") };
  }
  contactsChanged();
  return { message: accept ? "Ahora están conectados." : "Invitación rechazada." };
}

export async function saveContactTag(contact: string, tag: string): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const address = Address.safeParse(contact);
  const label = ContactTag.safeParse(tag);
  if (!address.success || !label.success) return { error: "Elige una etiqueta." };

  try {
    await ownerClient().setContactTag(owner, address.data, label.data);
  } catch (error) {
    return { error: actionError("saveContactTag", error, "No se pudo guardar. Intenta de nuevo.") };
  }
  contactsChanged();
  return {};
}

export async function saveTagPreset(tag: string, _: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const label = ContactTag.safeParse(tag);
  const share = form instanceof FormData ? sharingFrom(form) : undefined;
  if (!label.success || !share?.success) return { error: "Elige qué comparte esta etiqueta." };

  try {
    await ownerClient().setTagPreset(owner, label.data, share.data);
  } catch (error) {
    return { error: actionError("saveTagPreset", error, "No se pudo guardar. Intenta de nuevo.") };
  }
  contactsChanged();
  return { message: "Guardado." };
}

export async function saveSharing(contact: string, _: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const address = Address.safeParse(contact);
  const share = form instanceof FormData ? sharingFrom(form) : undefined;
  if (!address.success || !share?.success) return { error: "Elige qué le compartes." };

  try {
    await ownerClient().setSharing(owner, address.data, share.data);
  } catch (error) {
    return { error: actionError("saveSharing", error, "No se pudo guardar. Intenta de nuevo.") };
  }
  contactsChanged();
  return { message: "Guardado." };
}

export async function removeContact(contact: string): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const address = Address.safeParse(contact);
  if (!address.success) return { error: "La dirección no es válida." };

  try {
    await ownerClient().removeFriend(owner, address.data);
  } catch (error) {
    return { error: actionError("removeContact", error, "No se pudo quitar. Intenta de nuevo.") };
  }
  contactsChanged();
  return {};
}
