"use server";

import { BrokerError } from "@team-31/broker/client";
import { GrantInput, LocalPart, OwnerDecision, ToolResultSchemas } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ownerClient } from "@/lib/broker";
import { getTelemetry } from "@/lib/telemetry";

import { getOwner, requireAddress } from "./owner";
import { activityPageSize, validPage } from "./labels";

type Feedback = { error?: string; message?: string };

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

export async function claimAddress(_: Feedback, form: FormData): Promise<Feedback> {
  const owner = await getOwner();
  const localPart = LocalPart.safeParse(form instanceof FormData ? form.get("localPart") : undefined);
  if (!localPart.success) {
    return { error: "Usa de 2 a 31 caracteres, con letras minúsculas, números, puntos, guiones o guiones bajos. Empieza con una letra o número." };
  }

  try {
    await ownerClient().claimAddress(owner, localPart.data);
  } catch (error) {
    if (error instanceof BrokerError && error.code === "conflict") {
      return { error: "Esa dirección ya está tomada" };
    }
    return { error: actionError("claimAddress", error, "No se pudo guardar la dirección. Intenta de nuevo.") };
  }
  revalidatePath("/", "layout");
  redirect("/");
}

export async function readHome() {
  await requireAddress();
  const owner = await getOwner();
  const broker = ownerClient();
  return Promise.all([broker.pending(owner), broker.activity(owner, 4)]);
}

export async function readGrants() {
  await requireAddress();
  const owner = await getOwner();
  return ownerClient().grants(owner);
}

export async function saveGrant(_: Feedback, form: FormData): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  const parsed = GrantInput.safeParse(form instanceof FormData
    ? { grantee: form.get("grantee"), tool: form.get("tool"), fields: form.getAll("fields") }
    : undefined);
  if (!parsed.success) return { error: "Escribe una dirección Nexo válida y elige al menos un dato." };

  try {
    await ownerClient().setGrant(owner, parsed.data);
  } catch (error) {
    if (error instanceof BrokerError && error.code === "invalid_input") return { error: "Elige una dirección distinta a la tuya." };
    return { error: actionError("saveGrant", error, "No se pudo guardar el permiso. Intenta de nuevo.") };
  }
  revalidatePath("/grants");
  return { message: "Permiso guardado." };
}

export async function revokeGrant(grantId: string): Promise<Feedback> {
  await requireAddress();
  const owner = await getOwner();
  if (!routes.ownerRevokeGrant.params.safeParse({ id: grantId }).success || !grantId) return { error: "Elige un permiso válido." };

  try {
    await ownerClient().revokeGrant(owner, grantId);
  } catch (error) {
    return { error: actionError("revokeGrant", error, "No se pudo revocar el permiso. Intenta de nuevo.") };
  }
  revalidatePath("/grants");
  revalidatePath("/activity");
  return {};
}

export async function readActivity(input: unknown) {
  await requireAddress();
  const owner = await getOwner();
  const page = validPage(input);
  const last = page * activityPageSize;
  const items = await ownerClient().activity(owner, last + 1);
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
  return { message: "Decisión guardada." };
}

export async function readAgents() {
  await requireAddress();
  const owner = await getOwner();
  return ownerClient().agents(owner);
}

export async function manageAgent(agentId: string, _: Feedback, form: FormData): Promise<Feedback> {
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
