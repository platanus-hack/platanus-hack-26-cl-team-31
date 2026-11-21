"use client";

import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from "react";

import { button, primaryButton } from "./ui";

const CloseModal = createContext<() => void>(() => undefined);

export function useCloseModal() {
  return useContext(CloseModal);
}

export function ModalCancel() {
  const close = useCloseModal();
  return <button type="button" onClick={close} className={button}>Cancelar</button>;
}

export function Modal({ label, title, description, trigger, triggerClassName, wide, children }: {
  label: string; title: string; description?: string; trigger?: ReactNode; triggerClassName?: string; wide?: boolean; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(0);
  const titleId = useId();
  const close = useCallback(() => {
    const element = dialog.current;
    if (!element?.open || element.dataset.closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return element.close();
    element.dataset.closing = "";
    window.setTimeout(() => {
      delete element.dataset.closing;
      element.close();
    }, 150);
  }, []);
  return (
    <>
      <button type="button" aria-label={trigger ? label : undefined} className={triggerClassName ?? primaryButton} onClick={() => { setOpened(opened + 1); dialog.current?.showModal(); }}>
        {trigger ?? <>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 1.5v9M1.5 6h9" /></svg>
          {label}
        </>}
      </button>
      <dialog ref={dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        className={`menu m-auto w-[calc(100%-32px)] ${wide ? "max-w-[560px]" : "max-w-[440px]"} rounded-3xl p-0 text-ink backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-[sheet_200ms_var(--ease-smooth-out)]`}>
        <div className="relative p-6 sm:p-7">
          <h2 id={titleId} className="pr-10 text-lg font-medium tracking-[-0.01em] text-white">{title}</h2>
          {description ? <p className="mt-1 mb-6 text-[13px] leading-relaxed text-muted">{description}</p> : <div className="mb-5" />}
          <CloseModal.Provider value={close}>
            {opened > 0 && <div key={opened}>{children}</div>}
          </CloseModal.Provider>
          <button type="button" onClick={close} aria-label="Cerrar"
            className="absolute top-5 right-5 grid size-8 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-white/8 hover:text-ink sm:top-6 sm:right-6">
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m2.5 2.5 7 7M9.5 2.5l-7 7" /></svg>
          </button>
        </div>
      </dialog>
    </>
  );
}
