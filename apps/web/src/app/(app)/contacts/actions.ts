"use server";

import { Address, Sharing, TagColor, TagId, TagIds, TagName } from "@team-31/protocol";
import { BrokerError } from "@team-31/broker-client";
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

function tagsFrom(form: FormData) {
  return TagIds.safeParse(form.getAll("tag"));
}

function contactsChanged() {
  revalidatePath("/contacts");
  revalidatePath("/tags");
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
  const tags = tagsFrom(form);
  if (!tags.success) return { error: "Elige etiquetas válidas." };

  try {
    const view = await ownerClient().connect(owner, { to: to.data, tags: tags.data });
    contactsChanged();
    if (view.final && view.decision === "deny") return { error: "No encontramos a nadie con esa dirección." };
    if (view.final) return { message: `Ya estás conectado con ${to.data}.` };
  } catch (error) {
    if (error instanceof BrokerError && error.code === "invalid_input") return { error: error.message, ...(error.errorId && { errorId: error.errorId }) };
    return actionError("sendInvitation", error, "No se pudo enviar la invitación. Intenta de nuevo.");
  }
  return { message: `Invitación enviada a ${to.data}.` };
}

async function changeContact(operation: string, fallback: string, run: () => Promise<void>, success: Feedback): Promise<Feedback> {
  try {
    await run();
  } catch (error) {
    return actionError(operation, error, fallback);
  }
  contactsChanged();
  return success;
}

export async function answerInvitation(requestId: string, _: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const answer = form instanceof FormData ? form.get("answer") : null;
  if (answer !== "accept" && answer !== "decline") return { error: "Elige aceptar o rechazar." };
  const accept = answer === "accept";
  const tags = tagsFrom(form);
  if (accept && !tags.success) return { error: "Elige etiquetas válidas." };

  return changeContact("answerInvitation", "No se pudo responder la invitación. Intenta de nuevo.",
    () => ownerClient().answerInvitation(owner, requestId, { accept, ...(accept && tags.success ? { tags: tags.data } : {}) }), { message: accept ? "Ahora están conectados." : "Invitación rechazada." });
}

export async function saveContactTags(contact: string, ids: string[]): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const address = Address.safeParse(contact);
  const tags = TagIds.safeParse(ids);
  if (!address.success || !tags.success) return { error: "Elige etiquetas válidas." };

  return changeContact("saveContactTags", "No se pudo guardar. Intenta de nuevo.",
    () => ownerClient().setContactTags(owner, address.data, tags.data), {});
}

async function changeTag(operation: string, fallback: string, run: () => Promise<unknown>, success: Feedback): Promise<Feedback> {
  try {
    await run();
  } catch (error) {
    if (error instanceof BrokerError && error.code === "conflict") return { error: "Ya tienes una etiqueta con ese nombre." };
    return actionError(operation, error, fallback);
  }
  contactsChanged();
  return success;
}

export async function createTag(_: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const name = TagName.safeParse(form instanceof FormData ? form.get("name") : undefined);
  const color = TagColor.safeParse(form instanceof FormData ? form.get("color") : undefined);
  if (!name.success || !color.success) return { error: "Escribe un nombre y elige un color." };

  return changeTag("createTag", "No se pudo crear la etiqueta. Intenta de nuevo.",
    () => ownerClient().createTag(owner, { name: name.data, color: color.data }), { message: "Etiqueta creada." });
}

export async function saveTag(tagId: string, _: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const id = TagId.safeParse(tagId);
  if (!(form instanceof FormData)) return { error: "Revisa la etiqueta." };
  const name = TagName.safeParse(form.get("name"));
  const color = TagColor.safeParse(form.get("color"));
  const share = sharingFrom(form);
  if (!id.success || !name.success || !color.success || !share.success) return { error: "Revisa el nombre, el color y lo que comparte." };

  return changeTag("saveTag", "No se pudo guardar. Intenta de nuevo.",
    () => ownerClient().updateTag(owner, id.data, { name: name.data, color: color.data, categories: share.data }), { message: "Guardado." });
}

export async function deleteTag(tagId: string): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const id = TagId.safeParse(tagId);
  if (!id.success) return { error: "La etiqueta no es válida." };

  return changeContact("deleteTag", "No se pudo borrar la etiqueta. Intenta de nuevo.",
    () => ownerClient().deleteTag(owner, id.data), {});
}

export async function saveSharing(contact: string, _: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const address = Address.safeParse(contact);
  const share = form instanceof FormData ? sharingFrom(form) : undefined;
  if (!address.success || !share?.success) return { error: "Elige qué le compartes." };

  return changeContact("saveSharing", "No se pudo guardar. Intenta de nuevo.",
    () => ownerClient().setSharing(owner, address.data, share.data), { message: "Guardado." });
}

export async function removeContact(contact: string): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const address = Address.safeParse(contact);
  if (!address.success) return { error: "La dirección no es válida." };

  return changeContact("removeContact", "No se pudo quitar. Intenta de nuevo.",
    () => ownerClient().removeContact(owner, address.data), {});
}
