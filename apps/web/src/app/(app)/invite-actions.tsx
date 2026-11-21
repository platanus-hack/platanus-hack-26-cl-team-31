"use client";

import { useState } from "react";

import { reportBrowserFailure } from "@/lib/browser-feedback";

import { button, Feedback, input, primaryButton } from "./ui";

type ShareFeedback = "idle" | "copied" | "share_failed" | "copy_failed";

export function InviteActions({ url }: { url: string }) {
  const [feedback, setFeedback] = useState<ShareFeedback>("idle");
  const [pending, setPending] = useState(false);

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
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} disabled={pending} onClick={invite}>Invitar a Sideband</button>
        <button type="button" className={button} disabled={pending} onClick={copyLink}>Copiar enlace</button>
      </div>
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
  );
}
