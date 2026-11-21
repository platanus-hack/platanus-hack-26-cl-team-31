"use client";

import { useActionState, useState } from "react";
import { fieldsOf, GrantTool, type Grant } from "@team-31/protocol";

import { revokeGrant, saveGrant } from "../actions";
import { fieldLabels, toolLabels } from "../labels";
import { button, card, Empty, Feedback, input, primaryButton } from "../ui";

function GrantRow({ grant }: { grant: Grant }) {
  const [state, submit, pending] = useActionState(revokeGrant.bind(null, grant.id), {});
  return (
    <li className={`${card} flex flex-wrap items-center justify-between gap-3 px-5 py-4`}>
      <div>
        <p className="font-semibold">{grant.grantee}</p>
        <p className="text-sm text-[#525e50]">
          {toolLabels[grant.tool]}: {grant.fields.map((field) => fieldLabels[field] ?? field).join(", ")}
        </p>
        <Feedback {...state} />
      </div>
      <form action={submit}>
        <button className={button} disabled={pending} aria-label={`Revocar ${toolLabels[grant.tool]} a ${grant.grantee}`}>Revocar</button>
      </form>
    </li>
  );
}

export function GrantsEditor({ grants }: { grants: Grant[] }) {
  const [state, submit, pending] = useActionState(saveGrant, {});
  const [tool, setTool] = useState<GrantTool>("availability");

  return (
    <div className="space-y-8">
      {grants.length === 0 ? <Empty>Todavía no diste permisos. Sin un permiso, tus agentes no reciben la solicitud.</Empty> : (
        <ul className="space-y-3">{grants.map((grant) => <GrantRow key={grant.id} grant={grant} />)}</ul>
      )}

      <form action={submit} className={`${card} space-y-4 p-5`}>
        <h2 className="text-lg font-semibold">Dar un permiso</h2>
        <label className="block text-sm font-semibold">
          Dirección Nexo
          <input name="grantee" required placeholder="ana@nexo.app" className={`${input} mt-1`} />
        </label>
        <label className="block text-sm font-semibold">
          Puede pedir
          <select name="tool" value={tool} onChange={(event) => setTool(GrantTool.parse(event.target.value))} className={`${input} mt-1`}>
            {GrantTool.options.map((option) => <option key={option} value={option}>{toolLabels[option]}</option>)}
          </select>
        </label>
        <fieldset key={tool} className="space-y-2">
          <legend className="text-sm font-semibold">Y recibe</legend>
          {fieldsOf(tool).map((field) => (
            <label key={field} className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="fields" value={field} defaultChecked className="size-4 accent-[#28513b]" />
              {fieldLabels[field] ?? field}
            </label>
          ))}
        </fieldset>
        <button className={primaryButton} disabled={pending}>Dar permiso</button>
        <Feedback {...state} />
      </form>
    </div>
  );
}
