"use client";

import { useCallback, useState, useTransition } from "react";
import type { Circle } from "@team-31/protocol";

import { deleteCircle, joinCircle, removeFromCircle } from "./actions";
import { InviteMember } from "./circle-forms";
import { Modal, useCloseModal } from "../modal";
import { button, Feedback, Initial, primaryButton } from "../ui";
import { useUndoWindow } from "../use-undo-window";

type Result = { error?: string; message?: string; errorId?: string };

function Faces({ members }: { members: Circle["members"] }) {
  const shown = members.slice(0, 5);
  return (
    <div className="flex -space-x-2.5">
      {shown.map((member) => (
        <span key={member.address} className={`rounded-full ring-[3px] ring-card ${member.joined ? "" : "opacity-50"}`}>
          <span className="block"><Initial name={member.address} /></span>
        </span>
      ))}
      {members.length > shown.length && (
        <span className="grid size-9 place-items-center rounded-full bg-white/8 text-xs font-medium text-body ring-[3px] ring-card">+{members.length - shown.length}</span>
      )}
    </div>
  );
}

function useCircleAction() {
  const [state, setState] = useState<Result>({});
  const [pending, start] = useTransition();
  const run = useCallback((action: () => Promise<Result>, after?: () => void) => start(async () => {
    const result = await action();
    setState(result);
    if (!result.error) after?.();
  }), []);
  return { state, pending, run };
}

function CircleSheet({ circle, address, onGone, onLeave }: { circle: Circle; address: string; onGone: () => void; onLeave: () => void }) {
  const close = useCloseModal();
  const isOwner = circle.owner === address;
  const [members, setMembers] = useState(circle.members);
  const { state, pending, run } = useCircleAction();
  const [confirming, setConfirming] = useState(false);
  const others = members.filter((member) => member.joined && member.address !== address).length;

  function remove(member: string) {
    setMembers(members.filter((item) => item.address !== member));
    run(() => removeFromCircle(circle.id, member));
  }

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-stage">
        {members.map((member) => (
          <li key={member.address} className="group flex items-center gap-3 px-3.5 py-2.5">
            <Initial name={member.address} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{member.address}{member.address === address && <span className="text-muted"> (tú)</span>}</span>
              <span className="block text-xs text-muted">{member.address === circle.owner ? "Creador" : member.joined ? "Miembro" : "Invitación pendiente"}</span>
            </span>
            {isOwner && member.address !== address && (
              <button type="button" onClick={() => remove(member.address)} aria-label={`Quitar a ${member.address}`}
                className="h-7 shrink-0 cursor-pointer rounded-full px-2.5 text-[13px] text-muted transition hover:bg-white/8 hover:text-ink">Quitar</button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-body">Invitar a alguien</p>
          <InviteMember circleId={circle.id} circleName={circle.name} />
        </div>
      )}
      <p className="text-xs text-muted">Los miembros comparten su disponibilidad, sus horarios libres y sus coincidencias de interés mientras estén dentro.</p>
      <Feedback {...state} />
      {confirming ? (
        <div role="alertdialog" aria-label={`Eliminar ${circle.name}`} className="space-y-3 rounded-xl bg-danger-bg p-4">
          <p className="text-sm text-ink">¿Eliminar «{circle.name}»?</p>
          <p className="text-[13px] text-body">
            {others > 0 ? `${others === 1 ? "1 persona dejará" : `${others} personas dejarán`} de compartir disponibilidad e intereses por este círculo.` : "Nadie más está dentro todavía."} No se puede deshacer.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={button} onClick={() => setConfirming(false)} disabled={pending}>Cancelar</button>
            <button type="button" disabled={pending} onClick={() => run(() => deleteCircle(circle.id), () => { close(); onGone(); })}
              className="inline-flex h-8 cursor-pointer items-center rounded-full bg-danger/20 px-3.5 text-[13px] font-medium text-danger transition hover:bg-danger/30 disabled:opacity-50">
              {pending ? "Eliminando…" : "Eliminar círculo"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-line pt-4">
          <button type="button" onClick={() => (isOwner ? setConfirming(true) : (close(), onLeave()))}
            className="cursor-pointer text-[13px] font-medium text-danger hover:underline">{isOwner ? "Eliminar círculo" : "Salir del círculo"}</button>
          <button type="button" onClick={close} className={primaryButton}>Listo</button>
        </div>
      )}
    </div>
  );
}

export function CircleTile({ circle, address }: { circle: Circle; address: string }) {
  const [gone, setGone] = useState(false);
  const { state, pending: saving, run } = useCircleAction();
  const { scheduled, schedule, undo } = useUndoWindow(() =>
    run(() => removeFromCircle(circle.id, address), () => setGone(true)));
  if (gone) return null;
  if (scheduled || saving) {
    return (
      <li className="flex min-h-[140px] flex-col justify-center gap-2 rounded-2xl border border-dashed border-line p-5 text-[13px] text-muted">
        <span>Saliste de «{circle.name}».</span>
        {scheduled && <button type="button" onClick={undo} className="w-fit cursor-pointer font-medium text-accent-ink hover:underline">Deshacer</button>}
      </li>
    );
  }
  const joined = circle.members.filter((member) => member.joined).length;
  const pending = circle.members.length - joined;
  const isOwner = circle.owner === address;
  return (
    <li>
      <Modal label={`Abrir ${circle.name}`} title={circle.name} wide
        triggerClassName="flex h-full w-full cursor-pointer flex-col gap-5 rounded-2xl bg-card p-5 text-left transition-colors hover:bg-card-hover"
        trigger={<>
          <Faces members={circle.members} />
          <span className="block">
            <span className="block truncate text-base font-medium text-ink">{circle.name}</span>
            <span className="mt-1 block text-xs text-muted">
              {joined === 1 ? "1 miembro" : `${joined} miembros`}{pending > 0 && ` · ${pending} ${pending === 1 ? "pendiente" : "pendientes"}`} · {isOwner ? "Lo creaste tú" : `De ${circle.owner}`}
            </span>
          </span>
        </>}>
        <CircleSheet circle={circle} address={address} onGone={() => setGone(true)} onLeave={schedule} />
      </Modal>
      {state.error && <div className="pt-2"><Feedback {...state} /></div>}
    </li>
  );
}

export function CircleInvitation({ circle, address }: { circle: Circle; address: string }) {
  const { state, pending, run } = useCircleAction();
  const [answered, setAnswered] = useState<"joined" | "declined">();
  if (answered === "declined" && !state.error) return null;
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-2xl bg-accent-soft/50 p-5 ring-1 ring-accent/30 ring-inset">
      <Faces members={circle.members.filter((member) => member.joined)} />
      <div className="min-w-48 flex-1">
        <p className="text-sm text-ink"><span className="font-medium">{circle.owner}</span> te invitó a <span className="font-medium">{circle.name}</span></p>
        <p className="mt-0.5 text-xs text-body">{circle.members.filter((member) => member.joined).length} miembros</p>
      </div>
      {answered === "joined" && !state.error ? <p className="text-[13px] font-medium text-accent-ink">Ahora eres parte</p> : (
        <div className="flex gap-2">
          <button type="button" className={button} disabled={pending} onClick={() => { setAnswered("declined"); run(() => removeFromCircle(circle.id, address)); }}>Rechazar</button>
          <button type="button" className={primaryButton} disabled={pending} onClick={() => { setAnswered("joined"); run(() => joinCircle(circle.id)); }}>Aceptar</button>
        </div>
      )}
      {state.error && <div className="basis-full"><Feedback {...state} /></div>}
    </li>
  );
}

function InvitationRow({ circle, address }: { circle: Circle; address: string }) {
  const { state, pending, run } = useCircleAction();
  const [answered, setAnswered] = useState<"joined" | "declined">();
  if (answered === "declined" && !state.error) return null;
  const joined = circle.members.filter((member) => member.joined).length;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3.5 py-3">
      <Initial name={circle.owner} />
      <div className="min-w-40 flex-1">
        <p className="truncate text-sm font-medium text-ink">{circle.name}</p>
        <p className="truncate text-xs text-muted">De {circle.owner} · {joined === 1 ? "1 miembro" : `${joined} miembros`}</p>
      </div>
      {answered === "joined" && !state.error ? <p className="text-[13px] font-medium text-accent-ink">Ahora eres parte</p> : (
        <div className="ml-auto flex gap-2">
          <button type="button" className={button} disabled={pending} onClick={() => { setAnswered("declined"); run(() => removeFromCircle(circle.id, address)); }}>Rechazar</button>
          <button type="button" className={primaryButton} disabled={pending} onClick={() => { setAnswered("joined"); run(() => joinCircle(circle.id)); }}>Aceptar</button>
        </div>
      )}
      {state.error && <div className="basis-full"><Feedback {...state} /></div>}
    </li>
  );
}

export function CircleInvitations({ circles, address }: { circles: Circle[]; address: string }) {
  if (circles.length === 1) return <ul><CircleInvitation circle={circles[0]!} address={address} /></ul>;
  const owners = [...new Set(circles.map((circle) => circle.owner))];
  return (
    <Modal label="Revisar invitaciones a círculos" title={`${circles.length} invitaciones a círculos`} wide
      description="Si aceptas, compartirás tu disponibilidad, tus horarios libres y tus coincidencias de interés con sus miembros."
      triggerClassName="flex w-full cursor-pointer flex-wrap items-center gap-4 rounded-2xl bg-accent-soft/50 p-4 text-left ring-1 ring-accent/30 ring-inset transition-colors hover:bg-accent-soft/70"
      trigger={<>
        <span className="flex -space-x-2.5">
          {owners.slice(0, 4).map((owner) => <span key={owner} className="rounded-full ring-[3px] ring-[#13233a]"><Initial name={owner} /></span>)}
        </span>
        <span className="min-w-40 flex-1">
          <span className="block text-sm font-medium text-ink">{circles.length} invitaciones a círculos</span>
          <span className="block truncate text-xs text-body">{circles.slice(0, 3).map((circle) => circle.name).join(", ")}{circles.length > 3 ? ` y ${circles.length - 3} más` : ""}</span>
        </span>
        <span className="ml-auto inline-flex h-8 items-center rounded-full bg-accent-soft px-3.5 text-[13px] font-medium text-accent-ink">Revisar</span>
      </>}>
      <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-xl bg-stage">
        {circles.map((circle) => <InvitationRow key={circle.id} circle={circle} address={address} />)}
      </ul>
    </Modal>
  );
}
