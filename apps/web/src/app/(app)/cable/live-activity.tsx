"use client";

import type { ActivityItem } from "@team-31/protocol";
import { useEffect, useReducer, useState } from "react";

import { ActivitySubscription, type Connection } from "./activity-subscription";
import { ActivityDetail } from "../activity-list";
import { outcomeText, sentence } from "../activity-text";
import { eventLabels } from "../labels";
import { Modal } from "../modal";
import { card, Empty, Heading, Initial, ListSkeleton } from "../ui";

const connectionLabels: Record<Connection, string> = {
  connecting: "Conectando…",
  live: "En vivo",
  reconnecting: "Reconectando…",
};

const snapshotSize = 30;

function upsert(items: ActivityItem[], item: ActivityItem) {
  return [item, ...items.filter(({ requestId }) => requestId !== item.requestId)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, snapshotSize);
}

const steps = ["received", "permission", "wake", "response", "delivery"] as const;

function Steps({ item }: { item: ActivityItem }) {
  const done = new Set(item.events.map((event) => event.kind));
  const failed = item.status === "denied" || item.status === "delivery_failed" || item.status === "expired";
  const last = steps.reduce((index, step, current) => (done.has(step) ? current : index), -1);
  return (
    <ol aria-label="Recorrido" className="flex items-center gap-1">
      {steps.map((step, index) => {
        const reached = index <= last;
        const color = !reached ? "bg-white/10" : failed && index === last ? "bg-danger/70" : "bg-accent-ink/70";
        return (
          <li key={step} title={eventLabels[step]} className="flex items-center gap-1">
            <span className={`block h-1.5 w-6 rounded-full ${color}`} />
            <span className="sr-only">{eventLabels[step]}: {reached ? "listo" : "pendiente"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function LiveRow({ item, ready }: { item: ActivityItem; ready: boolean }) {
  const [settledItem, setSettledItem] = useState<ActivityItem>();
  useEffect(() => {
    const timer = setTimeout(setSettledItem, 1500, item);
    return () => clearTimeout(timer);
  }, [item]);

  const fresh = ready && item !== settledItem;
  const { other, lead, rest } = sentence(item);
  const [status, color] = outcomeText[item.status];
  return (
    <Modal label={`Ver detalle: ${rest}`} title={lead ? `${lead} ${rest}` : rest}
      triggerClassName={`flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors duration-700 hover:bg-white/3 ${fresh ? "bg-accent-soft" : ""}`}
      trigger={<>
        <Initial name={other} />
        <span className="min-w-48 flex-1">
          <span className="block text-sm text-body [overflow-wrap:anywhere]">{lead && <span className="font-medium text-ink">{lead} </span>}{rest}</span>
          <span className={`block text-xs ${color}`}>{status}</span>
        </span>
        <span className="ml-auto flex items-center gap-4">
          <Steps item={item} />
          <time dateTime={item.createdAt} className="w-12 text-right font-mono text-xs text-muted tabular-nums">{clock.format(new Date(item.createdAt))}</time>
        </span>
      </>}>
      <ActivityDetail item={item} />
    </Modal>
  );
}

const clock = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Santiago" });

export function LiveActivity() {
  const [items, receiveItem] = useReducer(upsert, []);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const subscription = new ActivitySubscription(receiveItem, setConnection);
    const settle = setTimeout(() => setReady(true), 1200);
    return () => {
      subscription.close();
      clearTimeout(settle);
    };
  }, []);

  return (
    <div>
      <Heading title="El cable" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-body">Las solicitudes de tus agentes, en el momento en que pasan.</p>
        <p role="status" className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${connection === "live" ? "bg-success-bg text-success" : "bg-warn-bg text-warn"}`}>
          <span aria-hidden="true" className="relative flex size-2">
            {connection === "live" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-50" />}
            <span className="relative inline-flex size-2 rounded-full bg-current" />
          </span>
          {connectionLabels[connection]}
        </p>
      </div>

      {items.length > 0 ? (
        <ul aria-label="Solicitudes" aria-live="polite" className={`${card} divide-y divide-line overflow-hidden`}>
          {items.map((item) => <li key={item.requestId}><LiveRow item={item} ready={ready} /></li>)}
        </ul>
      ) : connection === "connecting" ? <ListSkeleton rows={4} label="Conectando con el cable" /> : (
        <Empty>
          {connection === "reconnecting" ?
            "Se cortó la conexión. Reintentando…" : "Todo tranquilo. Cuando un agente pregunte o responda, aparecerá aquí al instante."}
        </Empty>
      )}
      <p className="mt-3 px-1 text-xs text-muted">Cada barra es un paso: recibida, permiso, aviso al agente, respuesta y entrega.</p>
    </div>
  );
}
