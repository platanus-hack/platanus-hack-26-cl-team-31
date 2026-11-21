"use server";

import { isSystemSender, WakeTarget } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { observeWebRequest, getTelemetry } from "@/lib/telemetry";

import { actionError, type Feedback } from "../../action-feedback";
import { clients, type ClientKind, type ManualWakeKind } from "./clients";
import { connectContext, listConnections } from "./connections";

type SaveFeedback = Feedback & { requestId?: string };
type PingFeedback = { requestId?: string; error?: string; errorId?: string };

export async function selectConnection(kind: ClientKind, form: FormData) {
  const connections = await listConnections();
  if (!Object.hasOwn(clients, kind) || !(form instanceof FormData)) return;
  const id = form.get("agentId");
  const selected = connections.find((agent) => agent.agentId === id);
  redirect(selected ? `/agents/connect/${kind}?agentId=${encodeURIComponent(selected.agentId)}` : `/agents/connect/${kind}`);
}

export async function saveWake(kind: ManualWakeKind, agentId: string, _state: SaveFeedback, form: FormData): Promise<SaveFeedback> {
  const { owner, broker } = await connectContext();
  if (!agentId || !routes.ownerSetWake.params.safeParse({ agentId }).success ||
    (kind !== "grokbot" && kind !== "openclaw") || !(form instanceof FormData)) {
    return { error: "Selecciona un agente para configurar su aviso." };
  }

  const url = form.get("url");
  const secret = form.get("secret");
  const remove = kind === "grokbot" && form.get("operation") === "remove";
  const configuration = kind === "grokbot"
    ? { kind: "grokbot_routine", url, key: secret }
    : { kind: "openclaw_hooks", baseUrl: url, token: secret, agentId: "main" };
  const target = WakeTarget.safeParse(remove ? { kind: "none" } : configuration);
  if (!target.success || (!remove && (typeof url !== "string" || !/^https?:\/\//i.test(url)))) {
    return { error: "Ingresa una URL HTTP o HTTPS y un secreto de al menos 16 caracteres." };
  }
  if (target.data.kind === "grokbot_routine" && /^(?:Authorization\s*:|Bearer\s)/i.test(target.data.key.trimStart())) {
    return { error: "Copia el campo key del panel Webhook de la rutina." };
  }

  try {
    await broker.setWake(owner, agentId, target.data);
  } catch (error) {
    return actionError("saveWake", error, "No se pudo actualizar el aviso. Comprueba que el agente siga conectado.");
  }

  getTelemetry().emit("web.agent.wake_configured", { userId: owner.userId, agentId, attrs: { kind: remove ? "none" : clients[kind].wakeKind } });
  revalidatePath("/agents");
  revalidatePath(`/agents/connect/${kind}`);
  if (remove) return { message: "Aviso quitado. El agente sigue conectado." };
  if (kind === "grokbot") {
    const ping = await startPing(kind, agentId);
    if (ping.error) return { error: "El aviso quedó guardado. Pulsa Probar para reintentar.", errorId: ping.errorId };
    return { requestId: ping.requestId };
  }
  return { message: "Aviso guardado." };
}

export async function startPing(kind: ClientKind, agentId: string): Promise<PingFeedback> {
  const { owner, broker } = await connectContext();
  if (!agentId || !routes.ownerPing.params.safeParse({ agentId }).success || !Object.hasOwn(clients, kind)) {
    return { error: "Selecciona un agente para probar la conexión." };
  }

  return observeWebRequest("POST", "/agents/connect", async (span): Promise<PingFeedback> => {
    const telemetry = getTelemetry();
    telemetry.identify({ userId: owner.userId, agentId });
    try {
      const agent = (await broker.agents(owner)).find((item) => item.agentId === agentId && !item.revokedAt);
      if (agent?.wakeKind !== clients[kind].wakeKind) {
        return { error: "Configura el aviso del agente antes de probarlo." };
      }
      const ping = await broker.ping(owner, agentId);
      telemetry.identify({ requestId: ping.requestId });
      telemetry.emit("web.agent.ping", { attrs: { stage: "started" } });
      return ping;
    } catch (error) {
      const errorId = telemetry.error("web.agent.start_ping", error);
      span.setErrorId(errorId);
      return { error: "No se pudo enviar la prueba. Intenta de nuevo.", errorId };
    }
  });
}

export async function readPingStatus(requestId: string) {
  if (!requestId || !routes.ownerDecide.params.safeParse({ id: requestId }).success) return;
  const { owner, broker } = await connectContext();

  return observeWebRequest("POST", "/agents/connect", async (span) => {
    const telemetry = getTelemetry();
    telemetry.identify({ userId: owner.userId, requestId });
    try {
      const items = await broker.activity(owner, { requestId });
      const ping = items.find((item) =>
        item.requestId === requestId && item.direction === "received" && isSystemSender(item.from));
      if (!ping) return;

      // El titular también puede responder una prueba escalada. La verificación exige la respuesta final del agente.
      const { status, events } = ping;
      const verified = (status === "answered" || status === "no_data") &&
        events.some((event) => event.kind === "response" && event.status === status);
      if (status !== "awaiting_agent" && status !== "awaiting_owner") {
        telemetry.emit("web.agent.ping", { attrs: { stage: "finished", outcome: status, verified } });
      }
      return { status, verified };
    } catch (error) {
      const errorId = telemetry.error("web.agent.read_ping_status", error);
      span.setErrorId(errorId);
      return { errorId };
    }
  });
}
