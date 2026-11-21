import type { ReactNode } from "react";

import { card } from "../../../ui";

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="space-y-4" aria-label="Pasos para conectar el bot">{children}</ol>;
}

export function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className={`${card} grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 p-4 sm:gap-4 sm:p-6`}>
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-chip text-sm font-medium text-accent-ink">{number}</span>
      <div className="min-w-0 space-y-4">
        <h2 className="flex min-h-8 items-center text-[15px] font-medium tracking-[-0.01em]"><span className="sr-only">Paso {number}. </span>{title}</h2>
        {children}
      </div>
    </li>
  );
}
