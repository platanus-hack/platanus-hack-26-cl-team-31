import type { ReactNode } from "react";
import type { RequestStatus } from "@team-31/protocol";

import { formatTime, statusLabels } from "./labels";

export const card = "rounded-2xl border border-[#dfe3d7] bg-[#fffefa] shadow-[0_1px_2px_#20332108]";
export const button = "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-[#dce0d3] bg-[#fffefa] px-3.5 py-2 text-sm font-semibold text-[#334531] transition hover:bg-[#f0f2e9] disabled:cursor-wait disabled:opacity-60";
export const primaryButton = "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg bg-[#28513b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e422e] disabled:cursor-wait disabled:opacity-60";
export const textLink = "font-semibold text-[#28513b] underline-offset-4 hover:underline";
export const input = "min-h-11 w-full rounded-lg border border-[#bfc7b8] bg-[#fffefa] px-3 py-2 text-[0.9375rem] text-[#20261d] placeholder:text-[#697465] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#28513b]";
export const secondaryText = "text-sm leading-relaxed text-[#525e50]";

export function Heading({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {children && <p className="mt-2 text-[#525e50]">{children}</p>}
      </div>
      {action}
    </header>
  );
}

export function Stamp({ value }: { value: string }) {
  return <time dateTime={value}>{formatTime(value)}</time>;
}

export function Status({ status }: { status: RequestStatus }) {
  const colors = {
    awaiting_owner: "bg-[#fbedcb] text-[#664710]",
    awaiting_agent: "bg-[#e4ecf5] text-[#2f4d6d]",
    answered: "bg-[#e3eedf] text-[#315232]",
    no_data: "bg-[#f0ede7] text-[#574e3d]",
    declined: "bg-[#f6e8e4] text-[#792f26]",
    denied: "bg-[#f6e8e4] text-[#792f26]",
    expired: "bg-[#f6e8e4] text-[#792f26]",
    delivery_failed: "bg-[#f6e8e4] text-[#792f26]",
  };
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${colors[status]}`}>{statusLabels[status]}</span>;
}

export function Feedback({ error, message }: { error?: string; message?: string }) {
  return error ? <p role="alert" className="text-sm text-[#902f25]">{error}</p> :
    message ? <p role="status" className="text-sm font-medium text-[#28513b]">{message}</p> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={`${card} px-5 py-6 text-sm text-[#525e50]`}>{children}</p>;
}
