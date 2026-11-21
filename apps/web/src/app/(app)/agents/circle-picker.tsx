"use client";

import { useActionState } from "react";

import { inviteToCircle } from "../circles/actions";
import { button, Feedback, input, secondaryText } from "../ui";

type Choice = { id: string; name: string; joined?: boolean };

export function CirclePicker({ address, circles }: { address: string; circles: Choice[] }) {
  const available = circles.filter(({ joined }) => joined === undefined);
  const [feedback, submit, pending] = useActionState(async (_: { error?: string; message?: string }, form: FormData) => {
    const circle = available.find(({ id }) => id === form.get("circle"));
    if (!circle) return { error: "Elige un círculo disponible." };
    const result = await inviteToCircle(circle.id, {}, form);
    return result.error ? result : { message: `Invitación enviada a ${address} para ${circle.name}.` };
  }, {});

  return (
    <div className="min-w-0 max-w-full space-y-2 sm:max-w-sm">
      {circles.filter(({ joined }) => joined !== undefined).map((circle) => (
        <p key={circle.id} className={`${secondaryText} break-words`}>
          {circle.name} · {circle.joined ? "Ya es miembro" : "Invitación pendiente"}
        </p>
      ))}
      {available.length > 0 && (
        <details>
          <summary className={`${button} list-none`}>Invitar a un círculo</summary>
          <form action={submit} className="mt-3 flex flex-wrap items-end gap-2">
            <input name="address" type="hidden" value={address} />
            <label className="min-w-0 flex-1 text-sm">Círculo
              <select name="circle" required defaultValue="" className={`${input} mt-1`}>
                <option disabled value="">Elige un círculo</option>
                {available.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <button className={button} disabled={pending}>{pending ? "Enviando…" : "Enviar invitación"}</button>
          </form>
        </details>
      )}
      <Feedback {...feedback} />
    </div>
  );
}
