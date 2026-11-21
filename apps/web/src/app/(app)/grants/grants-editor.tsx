"use client";

import { useActionState, useRef, useState } from "react";
import { fieldsOf, GrantTool, type Grant } from "@team-31/protocol";

import { revokeGrant, saveGrant } from "../actions";
import { fieldLabels, toolLabels } from "../labels";
import { button, card, Empty, Feedback, input, primaryButton } from "../ui";

function GrantRow({ grant, onEdit }: { grant: Grant; onEdit: () => void }) {
  const [state, submit, pending] = useActionState(revokeGrant.bind(null, grant.id), {});
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe3d7] py-3">
      <div>
        <p className="font-semibold">{toolLabels[grant.tool]}</p>
        <p className="text-sm text-[#525e50]">{grant.fields.map((field) => fieldLabels[field] ?? field).join(", ")}</p>
        <Feedback {...state} />
      </div>
      <form action={submit} className="flex gap-2">
        <button type="button" className={button} onClick={onEdit} aria-label={`Editar ${toolLabels[grant.tool]} de ${grant.grantee}`}>Editar</button>
        <button className={button} disabled={pending} aria-label={`Revocar ${toolLabels[grant.tool]} a ${grant.grantee}`}>Revocar</button>
      </form>
    </li>
  );
}

function GrantFields({ tool, grant }: { tool: GrantTool; grant?: Grant }) {
  const [selected, setSelected] = useState(grant?.fields ?? []);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Datos que puede recibir</legend>
      {fieldsOf(tool).map((field) => (
        <label key={field} className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="fields" value={field} checked={selected.includes(field)}
            onChange={(event) => setSelected(event.target.checked ? [...selected, field] : selected.filter((item) => item !== field))}
            className="size-4 accent-[#28513b]" />
          {fieldLabels[field] ?? field}
        </label>
      ))}
    </fieldset>
  );
}

export function GrantsEditor({ grants }: { grants: Grant[] }) {
  const [state, submit, pending] = useActionState(saveGrant, {});
  const [address, setAddress] = useState("");
  const [tool, setTool] = useState<GrantTool>("availability");
  const toolSelect = useRef<HTMLSelectElement>(null);
  const friends = new Map<string, Grant[]>();
  for (const grant of grants) {
    const permissions = friends.get(grant.grantee);
    if (permissions) permissions.push(grant);
    else friends.set(grant.grantee, [grant]);
  }
  const permissions = friends.get(address);
  const current = permissions?.find((grant) => grant.tool === tool);

  function edit(grant: Grant) {
    setAddress(grant.grantee);
    setTool(grant.tool);
    toolSelect.current?.focus();
  }

  return (
    <div className="space-y-8">
      <form action={submit} onReset={(event) => event.preventDefault()} className={`${card} space-y-4 p-5`}>
        <h2 className="text-lg font-semibold">{permissions ? "Permisos de este amigo" : "Agregar un amigo"}</h2>
        <label className="block text-sm font-semibold">
          Dirección Nexo de tu amigo
          <input name="grantee" required value={address} placeholder="ana@nexo.app" autoCapitalize="none" spellCheck={false}
            onChange={(event) => setAddress(event.target.value.trim().toLowerCase())} list="friends" className={`${input} mt-1`} />
          <datalist id="friends">{Array.from(friends.keys(), (friend) => <option key={friend} value={friend} />)}</datalist>
        </label>
        <label className="block text-sm font-semibold">
          Qué puede consultar
          <select ref={toolSelect} name="tool" value={tool} onChange={(event) => setTool(GrantTool.parse(event.target.value))} className={`${input} mt-1`}>
            {GrantTool.options.map((option) => <option key={option} value={option}>{toolLabels[option]}</option>)}
          </select>
        </label>
        <GrantFields key={JSON.stringify([tool, current?.id, current?.fields])} tool={tool} grant={current} />
        <button className={primaryButton} disabled={pending}>
          {current ? "Guardar cambios" : permissions ? "Agregar permiso" : "Agregar amigo con permiso"}
        </button>
        <Feedback {...state} />
      </form>

      <section aria-labelledby="friends-heading" className="space-y-3">
        <h2 id="friends-heading" className="text-lg font-semibold">Amigos con permiso</h2>
        {friends.size === 0 && <Empty>Todavía no le diste permiso a nadie.</Empty>}
        {Array.from(friends, ([friend, permissions]) => (
          <article key={friend} className={`${card} px-5 pt-4`}>
            <h3 className="mb-3 break-all font-semibold">{friend}</h3>
            <ul>{permissions.map((grant) => <GrantRow key={grant.id} grant={grant} onEdit={() => edit(grant)} />)}</ul>
          </article>
        ))}
      </section>
    </div>
  );
}
