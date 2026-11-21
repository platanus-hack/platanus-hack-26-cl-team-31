"use client";

import { useState, useTransition } from "react";
import type { SharingRules } from "@team-31/protocol";

import { saveRules } from "../actions";
import { button, Feedback, input, primaryButton, secondaryText } from "../ui";
import { AddressEntry, Addresses, Entry, RuleSection } from "./entries";
import { Permissions } from "./permissions";

function omit<T>(record: Record<string, T>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function find<T>(record: Record<string, T>, key: string) {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function RulesEditor({ initial }: { initial: SharingRules }) {
  const [rules, setRules] = useState(initial);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState<string>();
  const circles = [...new Set([...Object.keys(rules.circles), ...Object.keys(rules.grants)])];
  const people = Object.keys(rules.people);

  function change(updates: Partial<SharingRules>) {
    setRules((current) => ({ ...current, ...updates }));
    setFeedback({});
  }

  function validateCircleName(name: string, previous?: string) {
    if (!name) return "Ingresa un nombre para el círculo.";
    if (name !== previous && circles.includes(name)) return "Ya existe un círculo con ese nombre.";
  }

  return (
    <fieldset disabled={pending} className="min-w-0 space-y-5">
      <legend className="sr-only">Configuración de reglas</legend>
      <RuleSection title="Perfil público">
        <p className={secondaryText}>El perfil público se comparte con todas las personas que no hayas bloqueado.</p>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={Boolean(rules.publicProfile)}
            onChange={(event) => change({ publicProfile: event.target.checked ? { displayName: "" } : undefined })}
            className="size-4 accent-[#28513b]" />
          Mostrar mi perfil
        </label>
        {rules.publicProfile && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Nombre
              <input value={rules.publicProfile.displayName} onChange={(event) => change({
                publicProfile: { ...rules.publicProfile, displayName: event.target.value },
              })} className={`${input} mt-1`} />
            </label>
            <label className="text-sm font-medium">
              Titular (opcional)
              <input value={rules.publicProfile.headline ?? ""} onChange={(event) => change({
                publicProfile: { displayName: rules.publicProfile?.displayName ?? "", headline: event.target.value || undefined },
              })} className={`${input} mt-1`} />
            </label>
          </div>
        )}
      </RuleSection>
      <RuleSection title="Círculos">
        <Entry label="Nuevo círculo" buttonLabel="Crear círculo" placeholder="Amigos" onAdd={(name) => {
          const error = validateCircleName(name);
          if (error) return error;
          change({ circles: { ...rules.circles, [name]: [] } });
        }} />
        {circles.map((name) => {
          const addresses = find(rules.circles, name) ?? [];
          const grants = find(rules.grants, name) ?? [];
          return (
            <section key={name} className="space-y-4 rounded-xl border border-[#dfe3d7] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold [overflow-wrap:anywhere]">{name}</h3>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setRenaming(renaming === name ? undefined : name)} className={button}>
                    {renaming === name ? "Cancelar cambio de nombre" : "Renombrar"}
                  </button>
                  <button type="button" aria-label={`Quitar círculo ${name}`} className={button} onClick={() => {
                    change({ circles: omit(rules.circles, name), grants: omit(rules.grants, name) });
                  }}>Quitar círculo</button>
                </div>
              </div>
              {renaming === name && (
                <Entry label="Nuevo nombre" buttonLabel="Cambiar nombre" initial={name} onAdd={(nextName) => {
                  const error = validateCircleName(nextName, name);
                  if (error) return error;
                  if (nextName !== name) change({
                    circles: { ...omit(rules.circles, name), [nextName]: addresses },
                    grants: { ...omit(rules.grants, name), [nextName]: grants },
                  });
                  setRenaming(undefined);
                }} />
              )}
              <Addresses values={addresses} onRemove={(address) => change({
                circles: { ...rules.circles, [name]: addresses.filter((item) => item !== address) },
              })} />
              <AddressEntry label={`Dirección para ${name}`} buttonLabel="Añadir dirección" addresses={addresses}
                onAdd={(address) => change({ circles: { ...rules.circles, [name]: [...addresses, address] } })} />
              <Permissions circle value={grants} onChange={(next) => change({ grants: { ...rules.grants, [name]: next } })} />
            </section>
          );
        })}
      </RuleSection>
      <RuleSection title="Excepciones por persona">
        <AddressEntry label="Dirección de la persona" buttonLabel="Añadir excepción" addresses={people}
          onAdd={(address) => change({ people: { ...rules.people, [address]: [] } })} />
        {people.map((address) => (
          <section key={address} className="space-y-4 rounded-xl border border-[#dfe3d7] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="break-all font-semibold">{address}</h3>
              <button type="button" aria-label={`Quitar excepción para ${address}`} className={button}
                onClick={() => change({ people: omit(rules.people, address) })}>Quitar excepción</button>
            </div>
            <Permissions value={rules.people[address]} onChange={(grants) => change({ people: { ...rules.people, [address]: grants } })} />
          </section>
        ))}
      </RuleSection>
      <RuleSection title="Personas bloqueadas">
        <Addresses values={rules.blocked} onRemove={(address) => change({ blocked: rules.blocked.filter((item) => item !== address) })} />
        <AddressEntry label="Dirección a bloquear" buttonLabel="Bloquear" addresses={rules.blocked}
          onAdd={(address) => change({ blocked: [...rules.blocked, address] })} />
      </RuleSection>
      <RuleSection title="Solicitudes sin regla">
        <label className="block max-w-sm text-sm font-medium">
          Si me escribe alguien sin regla
          <select className={`${input} mt-1`} value={rules.defaultForUnknown} onChange={(event) => change({
            defaultForUnknown: event.target.value === "deny" ? "deny" : "ask_owner",
          })}>
            <option value="ask_owner">Preguntarme</option>
            <option value="deny">Rechazar</option>
          </select>
        </label>
      </RuleSection>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primaryButton} onClick={() => {
          setFeedback({});
          if (rules.publicProfile && !rules.publicProfile.displayName.trim()) {
            setFeedback({ error: "Escribe un nombre para el perfil público." });
            return;
          }
          startTransition(async () => { setFeedback(await saveRules(rules)); });
        }}>{pending ? "Guardando…" : "Guardar reglas"}</button>
        <Feedback {...feedback} />
      </div>
    </fieldset>
  );
}
