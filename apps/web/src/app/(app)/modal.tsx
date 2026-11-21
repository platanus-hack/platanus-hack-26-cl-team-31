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

export function Modal({ label, title, description, children }: { label: string; title: string; description: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(0);
  const titleId = useId();
  const close = useCallback(() => dialog.current?.close(), []);
  return (
    <>
      <button type="button" className={primaryButton} onClick={() => { setOpened(opened + 1); dialog.current?.showModal(); }}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 1.5v9M1.5 6h9" /></svg>
        {label}
      </button>
      <dialog ref={dialog} aria-labelledby={titleId} onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        className="menu m-auto w-[calc(100%-32px)] max-w-[440px] rounded-3xl p-0 text-ink backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-[sheet_200ms_var(--ease-smooth-out)]">
        <div className="p-6 sm:p-7">
          <h2 id={titleId} className="text-lg font-medium tracking-[-0.01em] text-white">{title}</h2>
          <p className="mt-1 mb-6 text-[13px] leading-relaxed text-muted">{description}</p>
          <CloseModal.Provider value={close}>
            {opened > 0 && <div key={opened}>{children}</div>}
          </CloseModal.Provider>
        </div>
      </dialog>
    </>
  );
}
