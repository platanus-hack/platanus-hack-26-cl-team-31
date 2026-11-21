import Link from "next/link";
import { ToolArgs } from "@team-31/protocol";

import { getAuthBaseUrl } from "@/lib/auth-env.mjs";

import { readHome } from "./actions";
import { ActivityList } from "./activity-list";
import { DecisionForm } from "./decision-form";
import { InviteActions } from "./invite-actions";
import { toolLabels } from "./labels";
import { card, Empty, Heading, Stamp, textLink } from "./ui";

export default async function HomePage() {
  const [pending, activity] = await readHome();
  const inviteUrl = new URL("/invite", new URL(getAuthBaseUrl()).origin).href;

  return (
    <>
      <Heading title="Inicio" action={<InviteActions url={inviteUrl} />}>
        Revisa solicitudes y respuestas de tus agentes.
      </Heading>
      <div className="grid items-start gap-8 lg:grid-cols-[1.35fr_1fr]">
        <section aria-labelledby="pending-title">
          <h2 id="pending-title" className="mb-4 text-xl font-semibold tracking-tight">Por revisar</h2>
          {pending.length === 0 ? <Empty>No tienes solicitudes pendientes.</Empty> : (
            <ul className="space-y-3">
              {pending.map((item) => {
                const slot = item.tool === "availability" ? ToolArgs.availability.parse(item.args) : undefined;
                const interest = item.tool === "interest_check" ? ToolArgs.interest_check.parse(item.args).interest : undefined;
                return (
                  <li key={item.requestId} className={`${card} p-5`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="break-all font-semibold">{item.from}</h3>
                      <p className="rounded-full bg-[#edf2e8] px-2.5 py-1 text-xs font-semibold text-[#365239]">{toolLabels[item.tool]}</p>
                    </div>
                    <p className="mt-2 text-xs text-[#525e50]">Vence el <Stamp value={item.expiresAt} /></p>
                    {slot && <p className="mt-3 text-sm text-[#344630]">{slot.date} · {slot.start} ({slot.timezone}) · {slot.durationMinutes} min</p>}
                    {interest && <p className="mt-3 break-words text-sm text-[#344630]">Interés consultado · {interest}</p>}
                    <div className="mt-3 rounded-lg bg-[#f2f3ed] p-3 text-sm">
                      <p className="font-semibold text-[#525e50]">Mensaje de un tercero</p>
                      {item.senderMessage.text || item.senderMessage.purpose ? (
                        <blockquote className="mt-1 space-y-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {item.senderMessage.text && <p>{item.senderMessage.text}</p>}
                          {item.senderMessage.purpose && <p>{item.senderMessage.purpose}</p>}
                        </blockquote>
                      ) : <p className="mt-1 text-[#525e50]">Sin mensaje.</p>}
                    </div>
                    <DecisionForm id={item.requestId} tool={item.tool} escalated={Boolean(item.escalated)} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="activity-title">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="activity-title" className="text-xl font-semibold tracking-tight">Actividad reciente</h2>
            <Link href="/activity" className={`${textLink} text-sm`}>Ver toda <span aria-hidden="true">↗</span></Link>
          </div>
          <ActivityList items={activity} />
        </section>
      </div>
    </>
  );
}
