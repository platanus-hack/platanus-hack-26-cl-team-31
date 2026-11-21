"use server";

import { Address, CircleName, type Owner } from "@team-31/protocol";
import { revalidatePath } from "next/cache";
import { ownerClient } from "@/lib/broker";
import { actionError, type Feedback } from "../action-feedback";
import { getOwner, readAsOwner, requireAddress } from "../owner";

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
