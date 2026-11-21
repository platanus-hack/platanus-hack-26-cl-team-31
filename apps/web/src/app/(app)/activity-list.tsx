import type { ActivityItem } from "@team-31/protocol";

import { eventLabels, statusLabels, toolLabels } from "./labels";
import { card, Empty, Stamp, Status } from "./ui";

export function ActivityList({ items, detailed = false }: { items: ActivityItem[]; detailed?: boolean }) {
  if (!items.length) return <Empty>No hay solicitudes en esta página.</Empty>;

  return (
    <ul className={`${card} divide-y divide-[#e6e8df]`}>
      {items.map((item) => (
        <li key={item.requestId} className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{toolLabels[item.tool]} · {item.direction === "sent" ? "Enviada" : "Recibida"}</p>
              <p className="mt-1 break-all text-sm text-[#525e50]">{item.from} <span aria-label="a">→</span> {item.to}</p>
            </div>
            <Status status={item.status} />
          </div>
          <p className="mt-2 text-xs text-[#525e50]"><Stamp value={item.createdAt} /></p>
          {detailed && (
            <details className="mt-3 text-sm">
              <summary className="w-fit cursor-pointer font-semibold text-[#28513b]">Ver bitácora</summary>
              <div className="mt-3 space-y-3">
                <p className="break-all font-mono text-xs text-[#525e50]">{item.requestId}</p>
                {item.outcome && <p><span className="font-semibold">Resultado</span> · {statusLabels[item.outcome]}</p>}
                {item.events.length > 0 ? (
                  <ol className="space-y-3 border-l border-[#d5dfd1] pl-4">
                    {item.events.map((event, index) => (
                      <li key={index}>
                        <p className="font-medium">{eventLabels[event.kind]}{event.status && ` · ${statusLabels[event.status]}`}</p>
                        <p className="text-xs text-[#525e50]"><Stamp value={event.at} /></p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-[#525e50]">Sin eventos registrados.</p>}
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
