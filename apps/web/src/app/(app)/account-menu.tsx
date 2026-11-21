"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { loadAuthClient } from "@/lib/load-auth-client";

type Account = { name: string; address: string; email: string; image?: string | null };

const item = "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-[#ededed] transition-colors hover:bg-white/6 disabled:cursor-wait disabled:opacity-60";

function Avatar({ account, size }: { account: Account; size: string }) {
  return account.image
    ? <span aria-hidden="true" style={{ backgroundImage: `url("${account.image}")` }} className={`${size} shrink-0 rounded-lg bg-cover bg-center tag`} />
    : <span aria-hidden="true" className={`${size} grid shrink-0 place-items-center rounded-lg bg-accent-soft text-[13px] font-medium text-accent-ink tag`}>{account.name.slice(0, 1).toUpperCase()}</span>;
}

export function AccountMenu({ account, compact = false }: { account: Account; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function copy() {
    await navigator.clipboard.writeText(account.address).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function signOut() {
    setLeaving(true);
    try {
      await (await loadAuthClient()).signOut();
    } finally {
      router.replace("/sign-in");
      router.refresh();
    }
  }

  return (
    <div ref={root} className="relative">
      {compact ? (
        <button type="button" aria-label="Abrir menú de la cuenta" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} className="grid cursor-pointer place-items-center rounded-lg">
          <Avatar account={account} size="size-8" />
        </button>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl p-2">
          <Avatar account={account} size="size-8" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-medium text-ink">{account.name}</p>
            <p className="truncate text-xs text-muted">{account.address}</p>
          </div>
          <button type="button" aria-label="Abrir menú de la cuenta" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}
            className={`grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-white/6 hover:text-ink ${open ? "bg-white/8 text-ink" : ""}`}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="13" cy="8" r="1.3" /></svg>
          </button>
        </div>
      )}
      {open && (
        <div role="menu" className={`menu absolute z-30 w-60 rounded-xl p-1.5 ${compact ? "top-full right-0 mt-2" : "bottom-full left-0 mb-2"}`}>
          <div className="px-2.5 pt-1.5 pb-2">
            <p className="truncate text-[13px] font-medium text-ink">{account.name}</p>
            <p className="truncate text-xs text-muted">{account.email}</p>
          </div>
          <div className="my-1 h-px bg-line" />
          <button type="button" role="menuitem" onClick={copy} className={item}>{copied ? "Dirección copiada" : "Copiar dirección"}</button>
          <Link role="menuitem" href="/agents" onClick={() => setOpen(false)} className={item}>Agentes conectados</Link>
          <div className="my-1 h-px bg-line" />
          <button type="button" role="menuitem" onClick={signOut} disabled={leaving} className={`${item} text-danger`}>{leaving ? "Cerrando sesión…" : "Cerrar sesión"}</button>
        </div>
      )}
    </div>
  );
}
