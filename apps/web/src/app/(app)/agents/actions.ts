"use server";

import { routes } from "@team-31/protocol/http";
import { revalidatePath } from "next/cache";
import { ownerClient } from "@/lib/broker";
import { actionError, type Feedback } from "../action-feedback";
import { getOwner, readAsOwner, requireAddress } from "../owner";

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
