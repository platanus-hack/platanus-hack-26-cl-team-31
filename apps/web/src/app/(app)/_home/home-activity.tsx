import type { ActivityItem } from "@team-31/protocol";

import { outcomeText, sentence } from "../activity-text";

import { formatRelative } from "../labels";
import { Empty } from "../ui";

export function HomeActivity({ items, now }: { items: ActivityItem[]; now: number }) {
  if (!items.length) return <Empty>Todavía no hay actividad. Cuando tus agentes pregunten o respondan, aparecerá aquí.</Empty>;
  return (
    <ol className="relative space-y-5 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-line">
      {items.map((item) => {
        const { lead, rest } = sentence(item);
        const [label, color, dot] = outcomeText[item.status];
        return (
          <li key={item.requestId} className="relative">
            <span aria-hidden="true" className={`absolute top-1.5 -left-6 size-[11px] rounded-full ring-4 ring-canvas ${dot} opacity-70`} />
            <p className="text-sm text-body">
              {lead && <span className="font-medium text-ink">{lead} </span>}{rest}
            </p>
            <p className="mt-0.5 text-xs"><span className={color}>{label}</span> <span className="text-muted">· {formatRelative(item.createdAt, now)}</span></p>
          </li>
        );
      })}
    </ol>
  );
}
