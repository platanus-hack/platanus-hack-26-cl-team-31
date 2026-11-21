"use server";

import { WakeTarget } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { observeWebRequest, webTelemetry } from "../../../../lib/telemetry";

import { clients, type ClientKind, type ManualWakeKind } from "./clients";
import { connectContext, listConnections } from "./connections";

type SaveFeedback = { error?: string; message?: string };
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
  const target = WakeTarget.safeParse(kind === "grokbot"
    ? { kind: "grokbot_routine", url, key: secret }
    : { kind: "openclaw_hooks", baseUrl: url, token: secret, agentId: "main" });
  if (!target.success || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { error: "Ingresa una URL HTTP o HTTPS y un secreto de al menos 16 caracteres." };
  }

  try {
    await broker.setWake(owner, agentId, target.data);
  } catch {
    return { error: "No se pudo guardar el aviso. Comprueba que el agente siga conectado." };
  }

  revalidatePath("/agents");
  revalidatePath(`/agents/connect/${kind}`);
  return { message: "Aviso guardado." };
}

export async function startPing(kind: ClientKind, agentId: string): Promise<PingFeedback> {
  const { owner, broker } = await connectContext();
  if (!agentId || !routes.ownerPing.params.safeParse({ agentId }).success || !Object.hasOwn(clients, kind)) {
    return { error: "Selecciona un agente para probar la conexión." };
  }

  return observeWebRequest("POST", "/agents/connect", async (span): Promise<PingFeedback> => {
    const telemetry = webTelemetry();
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
    const telemetry = webTelemetry();
    telemetry.identify({ userId: owner.userId, requestId });
    try {
      const items = await broker.activity(owner, 100);
      const ping = items.find((item) => item.requestId === requestId);
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
