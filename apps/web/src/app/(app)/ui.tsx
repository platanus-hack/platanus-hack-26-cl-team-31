import type { ReactNode } from "react";
import type { RequestStatus } from "@team-31/protocol";

import { formatTime, statusLabels } from "./labels";

export const card = "rounded-3xl bg-card surface transition-colors duration-150";
export const button = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-button px-4 text-[13px] font-medium text-white raised transition-colors duration-150 hover:bg-button-hover disabled:cursor-wait disabled:opacity-50";
export const primaryButton = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-medium text-white raised transition-colors duration-150 hover:bg-accent-hover disabled:cursor-wait disabled:opacity-50";
export const textLink = "font-medium text-accent-ink underline-offset-4 transition-colors hover:text-white hover:underline";
export const input = "h-10 w-full rounded-xl border border-line bg-stage px-3 text-sm text-ink placeholder:text-subtle transition-colors focus-visible:border-line-strong focus-visible:outline-none";
export const secondaryText = "text-[13px] leading-relaxed text-muted";
export const eyebrow = "font-mono text-[11px] uppercase tracking-[0.08em] text-subtle";

export function Heading({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[32px] leading-[1.1] font-medium tracking-[-0.005em] text-ink sm:text-[42px]">{title}</h1>
        {children && <p className="mt-3 text-[15px] leading-[22px] text-muted">{children}</p>}
      </div>
      {action}
    </header>
  );
}

export function Stamp({ value }: { value: string }) {
  return <time dateTime={value} className="font-mono tabular-nums">{formatTime(value)}</time>;
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
  return <span className={`inline-flex h-[22px] items-center rounded-full px-2.5 text-[11px] font-medium ${colors[status]}`}>{statusLabels[status]}</span>;
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
