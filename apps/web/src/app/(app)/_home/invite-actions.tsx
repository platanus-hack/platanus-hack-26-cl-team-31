"use client";

import { useEffect, useRef, useState } from "react";

import { reportBrowserFailure } from "@/lib/browser-feedback";

import { Feedback, input, primaryButton } from "../ui";

const item = "flex h-9 w-full cursor-pointer items-center rounded-lg px-2.5 text-left text-[13px] text-[#ededed] transition-colors hover:bg-white/6";

type ShareFeedback = "idle" | "copied" | "share_failed" | "copy_failed";

export function InviteActions({ url }: { url: string }) {
  const [feedback, setFeedback] = useState<ShareFeedback>("idle");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (feedback !== "copied") return;
    const timer = setTimeout(() => setFeedback("idle"), 2000);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function copyLink() {
    if (!navigator.clipboard) {
      setFeedback("copy_failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setFeedback("copied");
    } catch {
      setFeedback("copy_failed");
      void reportBrowserFailure("copy_invite").catch(() => undefined);
    }
  }

  async function invite() {
    const invitation = { title: "Invitación a Sideband", url };
    setFeedback("idle");
    setPending(true);

    try {
      if (!navigator.share || (navigator.canShare && !navigator.canShare(invitation))) {
        await copyLink();
        return;
      }
      await navigator.share(invitation);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setFeedback("share_failed");
        void reportBrowserFailure("share_invite").catch(() => undefined);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button type="button" className={primaryButton} disabled={pending} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Invitar a Sideband
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="m2.5 4 2.5 2.5L7.5 4" /></svg>
      </button>
      {open && (
        <div role="menu" className="menu absolute top-full right-0 z-30 mt-2 w-56 origin-top-right animate-[pop_160ms_var(--ease-smooth-out)] rounded-xl p-1.5">
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); void invite(); }}>Compartir enlace…</button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); void copyLink(); }}>Copiar enlace</button>
        </div>
      )}
      <div className="absolute top-full right-0 mt-2 w-72 empty:hidden">
        {feedback === "copied" && <Feedback message="Enlace copiado." />}
        {feedback === "share_failed" && <Feedback error="No se pudo abrir el menú. Puedes copiar el enlace." />}
        {feedback === "copy_failed" && (
          <>
            <Feedback message="Selecciona el enlace para copiarlo." />
            <input className={input} aria-label="Enlace de invitación" value={url} readOnly
              onFocus={(event) => event.currentTarget.select()} />
          </>
        )}
      </div>
    </div>
  );
}
