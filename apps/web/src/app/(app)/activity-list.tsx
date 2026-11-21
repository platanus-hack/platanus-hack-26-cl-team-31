import type { ActivityItem } from "@team-31/protocol";
import Link from "next/link";

import { outcomeText, sentence } from "./activity-text";
import { eventLabels, fieldLabels, formatRelative, statusLabels, toolLabels } from "./labels";
import { Modal } from "./modal";
import { card, Empty, Initial, Stamp } from "./ui";

const day = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Santiago" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" });

function dayLabel(value: string, now: number) {
  const key = dayKey.format(new Date(value));
  if (key === dayKey.format(now)) return "Hoy";
  if (key === dayKey.format(now - 86_400_000)) return "Ayer";
  const label = day.format(new Date(value));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Reason({ item }: { item: ActivityItem }) {
  if (item.direction !== "received" || !item.decisionReason) return null;
  return (
    <p className="mt-1 text-xs text-body">
      Motivo · {item.decisionReason}
      {item.status === "denied" && item.tool !== "connect" && (
        <> <Link href="/contacts" className="font-medium text-accent-ink hover:underline">Revisa qué le compartes a {item.from}</Link></>
      )}
    </p>
  );
}

export function ActivityDetail({ item }: { item: ActivityItem }) {
  const [label, color] = outcomeText[item.status];
  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`font-medium ${color}`}>{label}</span>
        <span className="text-muted">{toolLabels[item.tool]} · {item.direction === "sent" ? "Enviada" : "Recibida"}</span>
      </div>
      <Reason item={item} />
      {item.direction === "received" && item.internalReason && <p className="text-xs text-body">Motivo interno · {item.internalReason}</p>}
      {Boolean(item.droppedFields?.length) && <p className="text-xs text-body">Campos que no se entregaron · {item.droppedFields?.map((field) => fieldLabels[field] ?? field).join(", ")}</p>}
      {item.outcome && <p className="text-body">Resultado · {statusLabels[item.outcome]}</p>}
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-body">Bitácora</p>
        {item.events.length ? (
          <ol className="relative space-y-4 pl-5 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-line">
            {item.events.map((event, index) => (
              <li key={index} className="relative">
                <span aria-hidden="true" className="absolute top-1.5 -left-5 size-[7px] rounded-full bg-white/40 ring-4 ring-menu" />
                <p className="text-ink">{eventLabels[event.kind]}{event.status && <span className="text-muted"> · {statusLabels[event.status]}</span>}</p>
                <p className="text-xs text-muted"><Stamp value={event.at} /></p>
              </li>
            ))}
          </ol>
        ) : <p className="text-muted">Sin eventos registrados.</p>}
      </div>
      <p className="break-all border-t border-line pt-4 font-mono text-[11px] text-subtle">{item.requestId}</p>
    </div>
  );
}

export function ActivityList({ items, detailed = false, now = 0 }: { items: ActivityItem[]; detailed?: boolean; now?: number }) {
  if (!items.length) return <Empty>Todavía no hay actividad. Cuando tus agentes pregunten o respondan, aparecerá aquí.</Empty>;

  const groups = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const key = now ? dayLabel(item.createdAt, now) : "";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <div className="space-y-6">
      {[...groups].map(([label, group]) => (
        <section key={label} aria-label={label || undefined}>
          {label && <h2 className="mb-2 px-1 text-xs font-medium text-muted">{label}</h2>}
          <ul className={`${card} divide-y divide-line`}>
            {group.map((item) => {
              const { other, lead, rest } = sentence(item);
              const [status, color] = outcomeText[item.status];
              const row = (
                <>
                  <Initial name={other} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-body [overflow-wrap:anywhere]">{lead && <span className="font-medium text-ink">{lead} </span>}{rest}</span>
                    <span className={`block text-xs ${color}`}>{status}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{now ? formatRelative(item.createdAt, now) : <Stamp value={item.createdAt} />}</span>
                </>
              );
              return (
                <li key={item.requestId}>
                  {detailed ? (
                    <Modal label={`Ver detalle: ${rest}`} title={lead ? `${lead} ${rest}` : rest}
                      triggerClassName="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/3"
                      trigger={<>{row}<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted"><path d="m4.5 2.5 3.5 3.5-3.5 3.5" /></svg></>}>
                      <ActivityDetail item={item} />
                    </Modal>
                  ) : <div className="flex items-center gap-3 px-4 py-3">{row}</div>}
                  {item.direction === "received" && item.decisionReason && <div className="-mt-1 px-4 pb-3 pl-16"><Reason item={item} /></div>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
