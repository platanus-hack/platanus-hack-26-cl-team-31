import type { ReactNode } from "react";
import type { RequestStatus } from "@team-31/protocol";

import { formatTime, statusLabels } from "./labels";

export const card = "rounded-2xl bg-card transition-colors duration-150";
export const button = "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-button px-3 text-[13px] font-medium text-ink pill transition-colors duration-150 hover:bg-button-hover disabled:cursor-wait disabled:opacity-50";
export const primaryButton = "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-accent-soft px-3.5 text-[13px] font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-soft-hover disabled:cursor-wait disabled:opacity-50";
export const textLink = "font-medium text-ink underline decoration-white/20 underline-offset-4 transition-colors hover:decoration-white/60";
export const input = "h-10 w-full rounded-xl bg-field px-3 text-sm text-ink placeholder:text-subtle ring-1 ring-inset ring-[#2c2f36]/50 transition-shadow focus-visible:ring-white/20 focus-visible:outline-none";
export const secondaryText = "text-[13px] leading-relaxed text-muted";
export const eyebrow = "text-[11px] text-subtle";

export function Heading({ title, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className={`mb-6 flex items-center justify-between gap-4 ${action ? "" : "lg:hidden"}`}>
      <h1 className="text-2xl leading-8 font-medium tracking-[-0.01em] text-white lg:sr-only">{title}</h1>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </header>
  );
}

export function Stamp({ value }: { value: string }) {
  return <time dateTime={value} className="tabular-nums">{formatTime(value)}</time>;
}

export function Status({ status }: { status: RequestStatus }) {
  const colors = {
    awaiting_owner: "bg-warn-bg text-warn",
    awaiting_agent: "bg-info-bg text-info",
    answered: "bg-success-bg text-success",
    no_data: "bg-chip text-muted",
    declined: "bg-danger-bg text-danger",
    denied: "bg-danger-bg text-danger",
    expired: "bg-danger-bg text-danger",
    delivery_failed: "bg-danger-bg text-danger",
  };
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium tag ${colors[status]}`}>{statusLabels[status]}</span>;
}

export function Feedback({ error, message, errorId }: { error?: string; message?: string; errorId?: string }) {
  return error ? (
    <p role="alert" className="text-[13px] text-danger">
      {error}{errorId && <> Código de error <code className="font-mono">{errorId}</code>.</>}
    </p>
  ) :
    message ? <p role="status" className="text-[13px] font-medium text-accent-ink">{message}</p> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={`${card} px-5 py-6 text-[13px] text-muted`}>{children}</p>;
}

const avatarColors = [
  "bg-[#7db4ff]/25 text-[#9cc6ff]",
  "bg-[#7ddba3]/25 text-[#8fe3b2]",
  "bg-[#f2c66d]/25 text-[#f5d38e]",
  "bg-[#c4a1ff]/25 text-[#d2b8ff]",
  "bg-[#ff8f80]/25 text-[#ffab9f]",
  "bg-[#6fd6e0]/25 text-[#8fe0e8]",
  "bg-[#f59ac8]/25 text-[#f7b3d6]",
];

export function Initial({ name }: { name: string }) {
  const hash = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
  return <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-medium tag ${avatarColors[hash % avatarColors.length]}`}>{name.slice(0, 1).toUpperCase()}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse bg-white/6 ${className.includes("rounded") ? "" : "rounded-md"} ${className}`} />;
}

export function ListSkeleton({ rows = 4, label = "Cargando" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className={`${card} divide-y divide-line`}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className={`h-3.5 ${["w-2/5", "w-1/3", "w-1/2", "w-1/4"][index % 4]}`} />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-7 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({ rows = 5, tabs = false, label = "Cargando" }: { rows?: number; tabs?: boolean; label?: string }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        {tabs ? <div className="flex gap-2"><Skeleton className="h-[30px] w-24 rounded-full" /><Skeleton className="h-[30px] w-28 rounded-full" /><Skeleton className="h-[30px] w-24 rounded-full" /></div> : <span />}
        <Skeleton className="h-8 w-32 rounded-full" />
      </div>
      <ListSkeleton rows={rows} label={label} />
    </div>
  );
}
