"use client";

import type { ActivityItem } from "@team-31/protocol";
import { useEffect, useState } from "react";

import { eventLabels, fieldLabels, statusLabels, toolLabels } from "../labels";
import { card, Empty, Heading, Stamp, Status } from "../ui";

type Connection = "connecting" | "live" | "reconnecting";

const connectionLabels: Record<Connection, string> = {
  connecting: "Conectando…",
  live: "En vivo",
  reconnecting: "Reconectando…",
};

const clock = new Intl.DateTimeFormat("es-CL", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "America/Santiago",
});

const snapshotSize = 30;

function upsert(items: ActivityItem[], item: ActivityItem) {
  return [item, ...items.filter(({ requestId }) => requestId !== item.requestId)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, snapshotSize);
}

function LiveCard({ item }: { item: ActivityItem }) {
  return (
    <article className={`${card} overflow-hidden`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[15px] font-medium tracking-[-0.01em]">{toolLabels[item.tool]}</h2>
            <p className="text-xs font-medium text-muted">{item.direction === "sent" ? "Enviada" : "Recibida"}</p>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 break-all font-mono text-sm text-muted">
            <span>{item.from}</span><span aria-label="a">→</span><span>{item.to}</span>
          </p>
          <p className="mt-2 text-xs text-muted">Plazo <Stamp value={item.expiresAt} /></p>
        </div>
        {item.status === "no_data" ? (
          <span className="inline-block rounded-full bg-danger-bg px-2.5 py-1 text-xs font-medium text-danger">
            {statusLabels.no_data}
          </span>
        ) : <Status status={item.status} />}
      </header>

      <div className="px-5 py-5 sm:px-6">
        {item.events.length > 0 ? (
          <ol aria-label="Recorrido de la solicitud" className="ml-1.5 border-l border-line">
            {item.events.map((event, index) => (
              <li key={index} className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-4 pl-5 last:pb-0">
                <span aria-hidden="true" className="absolute top-1.5 -left-[5px] size-[9px] rounded-full bg-accent ring-2 ring-card" />
                <time dateTime={event.at} className="font-mono text-xs tabular-nums text-muted">
                  {clock.format(new Date(event.at))}
                </time>
                <p className="text-sm font-medium">{eventLabels[event.kind]}</p>
                {event.status && <p className="text-xs text-muted">{statusLabels[event.status]}</p>}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted">Aún no hay eventos registrados.</p>}

        {(Boolean(item.droppedFields?.length) ||
          (item.direction === "received" && (item.decisionReason || item.internalReason))) && (
          <dl className="mt-5 space-y-2 rounded-xl stage px-4 py-3 text-sm">
            {Boolean(item.droppedFields?.length) && (
              <div>
                <dt className="font-medium">Campos eliminados</dt>
                <dd className="mt-0.5 wrap-anywhere text-muted">
                  {item.droppedFields?.map((field) => fieldLabels[field] ?? field).join(", ")}
                </dd>
              </div>
            )}
            {item.direction === "received" && item.decisionReason && (
              <div>
                <dt className="font-medium">Motivo de la decisión</dt>
                <dd className="mt-0.5 wrap-anywhere text-muted">{item.decisionReason}</dd>
              </div>
            )}
            {item.direction === "received" && item.internalReason && (
              <div>
                <dt className="font-medium">Motivo interno</dt>
                <dd className="mt-0.5 wrap-anywhere text-muted">{item.internalReason}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </article>
  );
}

export function LiveActivity() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");

  useEffect(() => {
    let source: EventSource;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1_000;

    function connect() {
      source = new EventSource("/cable/stream");
      source.onopen = () => {
        retryDelay = 1_000;
        setConnection("live");
      };
      source.onerror = () => {
        setConnection("reconnecting");
        // EventSource retries stream interruptions itself but stops on HTTP errors.
        if (source.readyState === EventSource.CLOSED) {
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 15_000);
        }
      };
      source.addEventListener("activity", (event: MessageEvent<string>) => {
        // The same-origin route validates and reserializes every activity frame.
        const item = JSON.parse(event.data) as ActivityItem;
        setItems((previous) => upsert(previous, item));
      });
    }

    connect();
    return () => {
      clearTimeout(retryTimer);
      source.close();
    };
  }, []);

  return (
    <div className="max-w-4xl">
      <Heading title="El cable" action={(
        <p role="status" className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
          connection === "live" ? "bg-success-bg text-success" : "bg-warn-bg text-warn"
        }`}>
          <span aria-hidden="true" className="size-2 rounded-full bg-current" />
          {connectionLabels[connection]}
        </p>
      )}>
        Sigue el recorrido de tus solicitudes enviadas y recibidas.
      </Heading>

      {items.length > 0 ? (
        <ul aria-label="Solicitudes" className="space-y-4">
          {items.map((item) => <li key={item.requestId}><LiveCard item={item} /></li>)}
        </ul>
      ) : (
        <Empty>
          {connection === "connecting" ? "Cargando solicitudes…" : connection === "reconnecting" ?
            "Esperando a que vuelva la conexión." : "Las nuevas solicitudes aparecerán aquí."}
        </Empty>
      )}
    </div>
  );
}
