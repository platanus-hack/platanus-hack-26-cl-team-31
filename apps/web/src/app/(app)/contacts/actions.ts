"use server";

import { Address, ContactTag, Sharing } from "@team-31/protocol";
import { BrokerError } from "@team-31/broker/client";
import { revalidatePath } from "next/cache";
import { ownerClient } from "@/lib/broker";
import { actionError, type Feedback } from "../action-feedback";
import { getOwner, readAsOwner, requireAddress } from "../owner";

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
