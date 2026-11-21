import Link from "next/link";

import { getOwnerAccount } from "@/lib/auth-owner";
import { getAuthBaseUrl } from "@/lib/auth-env.mjs";

import { readHome } from "./actions";
import { HomeActivity } from "./_home/home-activity";
import { InviteActions } from "./_home/invite-actions";
import { FocusRequest, RequestRow } from "./_home/request-row";
import { formatRelative } from "./labels";
import { card } from "./ui";

const sectionTitle = "text-[15px] font-medium tracking-[-0.01em]";
const sectionLink = "text-[13px] font-medium text-accent-ink hover:underline";
const hour = new Intl.DateTimeFormat("es-CL", { hour: "numeric", hourCycle: "h23", timeZone: "America/Santiago" });

function greeting(now: number) {
  const value = Number(hour.format(now));
  return value < 12 ? "Buenos días" : value < 20 ? "Buenas tardes" : "Buenas noches";
}

function Tile({ href, label, value, hint, tone = "" }: { href: string; label: string; value: number; hint: string; tone?: string }) {
  return (
    <Link href={href} className={`${card} group flex flex-col gap-1 p-5 transition-colors hover:bg-card-hover`}>
      <span className="text-[13px] text-muted">{label}</span>
      <span className={`text-[32px] leading-10 font-medium tracking-[-0.02em] tabular-nums ${value ? tone || "text-white" : "text-muted"}`}>{value}</span>
      <span className="text-xs text-muted transition-colors group-hover:text-body">{hint} ›</span>
    </Link>
  );
}

export default async function HomePage() {
  const [{ pending, activity, answered, invitations, contacts, agents, now }, account] = await Promise.all([readHome(), getOwnerAccount()]);
  const inviteUrl = new URL("/invite", new URL(getAuthBaseUrl()).origin).href;
  const name = (account.displayName || account.user.name || "").split(" ")[0];
  const expires = (value: string) => formatRelative(value, now).replace("dentro de ", "en ");
  const [first, ...rest] = pending;

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 lg:pt-2">
        <div>
          <h1 className="text-2xl leading-8 font-medium tracking-[-0.02em] text-white sm:text-[28px] sm:leading-9">{greeting(now)}{name ? `, ${name}` : ""}</h1>
          <p className="mt-1 text-sm text-body">
            {pending.length === 0 ? "Nada espera tu decisión. Tus agentes se encargan del resto." : `Tienes ${pending.length} ${pending.length === 1 ? "solicitud esperando" : "solicitudes esperando"} tu decisión.`}
            {invitations.length > 0 && ` ${invitations.length} ${invitations.length === 1 ? "persona quiere" : "personas quieren"} conectar contigo.`}
          </p>
        </div>
        <InviteActions url={inviteUrl} />
      </div>

      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile href="/activity" label="Tus agentes respondieron" value={answered} hint="En las últimas 24 h" tone="text-success" />
        <Tile href="/contacts?vista=solicitudes" label="Quieren conectar" value={invitations.length} hint="Ver solicitudes" tone="text-accent-ink" />
        <Tile href="/contacts" label="Contactos" value={contacts} hint="Tu red" />
        <Tile href="/agents?vista=conexiones" label="Agentes activos" value={agents} hint="Conexiones" />
      </div>

      <div className="grid items-start gap-10 lg:grid-cols-[1.6fr_1fr]">
        <section id="por-decidir" aria-labelledby="pending-title" className="scroll-mt-20">
          <h2 id="pending-title" className={`${sectionTitle} mb-3`}>Lo más urgente</h2>
          {first ? (
            <div className="space-y-3">
              <FocusRequest item={first} expires={expires(first.expiresAt)} />
              {rest.length > 0 && (
                <>
                  <p className="pt-3 text-[13px] text-muted">Y {rest.length} más</p>
                  <ul className={`${card} divide-y divide-line`}>
                    {rest.map((item) => <RequestRow key={item.requestId} item={item} expires={`vence ${expires(item.expiresAt)}`} />)}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <div className={`${card} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
              <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-success-bg text-success">✓</span>
              <p className="text-sm font-medium text-ink">Nada por decidir</p>
              <p className="text-[13px] text-muted">Cuando alguien te pregunte algo que debas aprobar, aparecerá aquí.</p>
            </div>
          )}
        </section>
        <section aria-labelledby="activity-title">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2 id="activity-title" className={sectionTitle}>Actividad reciente</h2>
            <Link href="/activity" className={sectionLink}>Ver toda ›</Link>
          </div>
          <HomeActivity items={activity} now={now} />
        </section>
      </div>
    </>
  );
}
