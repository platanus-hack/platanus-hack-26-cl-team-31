"use server";

import { BrokerError } from "@team-31/broker/client";
import { LocalPart, OwnerDecision, ToolResultSchemas } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ownerClient } from "@/lib/broker";
import { onboardingFlow, type OnboardingSource } from "@/lib/onboarding-flow";
import { getTelemetry, observeWebRequest } from "@/lib/telemetry";

import { getOwner, readAsOwner, requireAddress } from "./owner";
import { activityPageSize, parseActivityPage } from "./labels";

import { actionError, type Feedback } from "./action-feedback";

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
  const { data: [pending, activity, { incoming }] } = await readAsOwner((owner) => {
    const broker = ownerClient();
    return Promise.all([broker.pending(owner), broker.activity(owner, 4), broker.contacts(owner)]);
  });
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
