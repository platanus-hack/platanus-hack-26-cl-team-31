import Link from "next/link";
import { ToolArgs } from "@team-31/protocol";

import { getAuthBaseUrl } from "@/lib/auth-env.mjs";

import { readHome } from "./actions";
import { ActivityList } from "./activity-list";
import { DecisionForm } from "./decision-form";
import { InviteActions } from "./invite-actions";
import { toolLabels } from "./labels";
import { OwnerProfile } from "./owner-profile";
import { card, Empty, Heading, Stamp, textLink } from "./ui";

export default async function HomePage() {
  const [pending, activity, invitations] = await readHome();
  const inviteUrl = new URL("/invite", new URL(getAuthBaseUrl()).origin).href;

  return (
    <>
      <Heading title="Inicio" action={<InviteActions url={inviteUrl} />}>
        Revisa tus solicitudes, las respuestas de tus agentes y tu perfil.
      </Heading>
      <div className="grid items-start gap-8 lg:grid-cols-[1.35fr_1fr]">
        <section aria-labelledby="pending-title">
          <h2 id="pending-title" className="mb-4 text-[15px] font-medium tracking-[-0.01em]">Por revisar</h2>
          {invitations.length > 0 && (
            <Link href="/contacts" className={`${card} mb-3 flex items-center justify-between gap-3 px-5 py-4 transition hover:bg-chip`}>
              <span className="text-sm">
                <span className="break-all font-medium">{invitations[0]!.address}</span>
                {invitations.length > 1 ? ` y ${invitations.length - 1} más quieren conectar contigo.` : " quiere conectar contigo."}
              </span>
              <span className="shrink-0 text-sm font-medium text-accent">Responder ›</span>
            </Link>
          )}
          {pending.length === 0 && invitations.length === 0 ? <Empty>No tienes solicitudes pendientes.</Empty> : (
            <ul className="space-y-3">
              {pending.map((item) => {
                const slot = item.tool === "availability" ? ToolArgs.availability.parse(item.args) : undefined;
                const interest = item.tool === "interest_check" ? ToolArgs.interest_check.parse(item.args).interest : undefined;
                return (
                  <li key={item.requestId} className={`${card} p-5`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="break-all font-medium">{item.from}</h3>
                      <p className="rounded-full bg-chip px-2.5 py-1 text-xs font-medium text-body">{toolLabels[item.tool]}</p>
                    </div>
                    <p className="mt-2 text-xs text-muted">Vence el <Stamp value={item.expiresAt} /></p>
                    {slot && <p className="mt-3 text-sm text-body">{slot.date} · {slot.start} ({slot.timezone}) · {slot.durationMinutes} min</p>}
                    {interest && <p className="mt-3 break-words text-sm text-body">Interés consultado · {interest}</p>}
                    <div className="mt-3 rounded-xl stage p-3 text-sm">
                      <p className="font-medium text-muted">Mensaje de un tercero</p>
                      {item.senderMessage.text || item.senderMessage.purpose ? (
                        <blockquote className="mt-1 space-y-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {item.senderMessage.text && <p>{item.senderMessage.text}</p>}
                          {item.senderMessage.purpose && <p>{item.senderMessage.purpose}</p>}
                        </blockquote>
                      ) : <p className="mt-1 text-muted">Sin mensaje.</p>}
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
            <h2 id="activity-title" className="text-[15px] font-medium tracking-[-0.01em]">Actividad reciente</h2>
            <Link href="/activity" className={`${textLink} text-sm`}>Ver toda <span aria-hidden="true">↗</span></Link>
          </div>
          <ActivityList items={activity} />
        </section>
      </div>
      <OwnerProfile />
    </>
  );
}
