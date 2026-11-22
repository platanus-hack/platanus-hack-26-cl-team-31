"use server";

import { OwnerDecision, ToolResultSchemas } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { revalidatePath } from "next/cache";

import { ownerClient } from "@/lib/broker";

import { getOwner, readAsOwner, requireAddress } from "./owner";

import { actionError, type Feedback } from "./action-feedback";

export async function readHome() {
  const { data: [pending, activity, { incoming, contacts }, agents] } = await readAsOwner((owner) => {
    const broker = ownerClient();
    return Promise.all([broker.pending(owner), broker.activity(owner, 50), broker.contacts(owner), broker.agents(owner)]);
  });
  const now = Date.now();
  return {
    pending: pending.filter((item) => item.tool !== "connect"),
    activity: activity.slice(0, 6),
    answered: activity.filter((item) => item.direction === "received" && item.status === "answered"
      && now - new Date(item.closedAt ?? item.createdAt).getTime() < 86_400_000).length,
    invitations: incoming,
    contacts: contacts.length,
    agents: agents.filter((agent) => !agent.revokedAt).length,
    now,
  };
}

export async function decide(requestId: string, _: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  if (!(form instanceof FormData)) return { error: "Elige una decisión válida." };
  const kind = form.get("decision");
  const validKind = kind === "grant_category" || kind === "grant_vault_read" || kind === "approve_once" || kind === "deny" || kind === "yes" || kind === "no" || kind === "answer";
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
    return actionError("decide", error, "No se pudo registrar la decisión. Intenta de nuevo.");
  }

  revalidatePath("/");
  revalidatePath("/activity");
  revalidatePath("/contacts");
  if (kind === "grant_vault_read") revalidatePath("/vault");
  return { message: "Decisión guardada." };
}
