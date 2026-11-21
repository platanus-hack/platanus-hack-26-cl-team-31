"use client";

import { fieldsOf, ToolName, type SharingRules } from "@team-31/protocol";

import { fieldLabels, toolLabels } from "../labels";
import { button, input } from "../ui";

type Grant = SharingRules["people"][string][number];
type CircleGrant = SharingRules["grants"][string][number];

type GrantListProps =
  | { circle: true; value: CircleGrant[]; onChange: (grants: CircleGrant[]) => void }
  | { circle?: false; value: Grant[]; onChange: (grants: Grant[]) => void };

export function Permissions(props: GrantListProps) {
  const { value, circle } = props;

  function update(grants: (Grant | CircleGrant)[]) {
    if (props.circle) {
      props.onChange(grants.map((grant) => ({ ...grant, never: "never" in grant && grant.never })));
    } else {
      props.onChange(grants);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {ToolName.options.filter((tool) => tool !== "connect").map((tool) => {
        const entries = value.map((grant, index) => ({ grant, index })).filter(({ grant }) => grant.tool === tool);
        return (
          <section key={tool} className="min-w-0 rounded-xl border border-[#dfe3d7] bg-[#fcfcf7] p-3">
            <h4 className="mb-2 text-sm font-semibold">{toolLabels[tool]}</h4>
            {entries.length === 0 ? (
              <button type="button" onClick={() => update([...value, { tool, fields: [], guidance: "" }])}
                aria-label={`Añadir regla de ${toolLabels[tool]}`} className={button}>Añadir regla</button>
            ) : entries.map(({ grant, index }) => {
              const never = circle && "never" in grant && grant.never;
              const replace = (changed: Grant | CircleGrant) => update(value.map((current, currentIndex) => currentIndex === index ? changed : current));
              return (
                <div key={index} className="space-y-2 [&+&]:mt-3 [&+&]:border-t [&+&]:pt-3">
                  {circle && (
                    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" role="switch" checked={Boolean(never)}
                        onChange={(event) => replace({ ...grant, never: event.target.checked })}
                        className="size-4 accent-[#28513b]" />
                      Nunca
                    </label>
                  )}
                  <fieldset disabled={Boolean(never)} className="min-w-0 space-y-2 disabled:opacity-55">
                    <legend className="text-xs font-medium text-[#525e50]">Campos permitidos</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {fieldsOf(tool).map((field) => (
                        <label key={field} className="relative">
                          <input type="checkbox" checked={grant.fields.includes(field)}
                            onChange={(event) => replace({
                              ...grant,
                              fields: event.target.checked ? [...grant.fields, field] : grant.fields.filter((item) => item !== field),
                            })}
                            className="peer sr-only" />
                          <span className="inline-flex min-h-8 cursor-pointer items-center rounded-md border border-[#bfc7b8] px-2 py-1 text-xs font-medium peer-checked:border-[#426349] peer-checked:bg-[#e4efdf] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#28513b] peer-disabled:cursor-default">
                            {fieldLabels[field] ?? field}
                          </span>
                        </label>
                      ))}
                    </div>
                    <label className="block text-xs font-medium text-[#525e50]">
                      Instrucciones para el agente
                      <textarea rows={2} value={grant.guidance}
                        onChange={(event) => replace({ ...grant, guidance: event.target.value })}
                        className={`${input} mt-1 min-h-10 text-sm`} />
                    </label>
                  </fieldset>
                  <button type="button" onClick={() => update(value.filter((_, currentIndex) => currentIndex !== index))}
                    aria-label={`Quitar regla de ${toolLabels[tool]}`} className="min-h-8 cursor-pointer text-xs font-semibold text-[#7f352d] underline-offset-4 hover:underline">Quitar regla</button>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
