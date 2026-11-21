"use server";

import type { RequestStatus } from "@team-31/protocol";
import { WakeTarget } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clients, type ClientKind, type ManualWakeKind } from "./clients";
import { connectContext, listConnections } from "./connections";

type SaveFeedback = { error?: string; message?: string };
type PingFeedback = { requestId?: string; error?: string };

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

  try {
    const agent = (await broker.agents(owner)).find((item) => item.agentId === agentId && !item.revokedAt);
    if (agent?.wakeKind !== clients[kind].wakeKind) {
      return { error: "Configura el aviso del agente antes de probarlo." };
    }
    return await broker.ping(owner, agentId);
  } catch {
    return { error: "No se pudo enviar la prueba. Intenta de nuevo." };
  }
}

export async function readPingStatus(requestId: string): Promise<RequestStatus | undefined> {
  const { owner, broker } = await connectContext();
  if (!requestId || !routes.ownerDecide.params.safeParse({ id: requestId }).success) return;
  const items = await broker.activity(owner, 100);
  return items.find((item) => item.requestId === requestId)?.status;
}
