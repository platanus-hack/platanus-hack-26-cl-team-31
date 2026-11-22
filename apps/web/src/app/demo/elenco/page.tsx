import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { cast, castAddress, castPrincipal, healthCategory, weekdays, type CastMember, type Weekday } from "@team-31/demo/cast";
import { categories, type OwnerPendingItem } from "@team-31/protocol";
import { ownerClient } from "@/lib/broker";
import { getTelemetry } from "@/lib/telemetry";
import { decideForCast } from "./actions";
import "../demo.css";
import "./elenco.css";

export const metadata: Metadata = {
  title: "Sideband — Contactos de demostración",
  description: "Perfiles públicos, datos privados y permisos de los contactos ficticios.",
};

const tries = [
  "¿A alguien de mis contactos le interesa el fútbol?",
  "¿Quién de mis contactos está libre el sábado a las 11 por una hora?",
  "¿Qué tiene guardado Sofía en Salud?",
];

const dayNames: Record<Weekday, string> = {
  sunday: "Domingo", monday: "Lunes", tuesday: "Martes", wednesday: "Miércoles",
  thursday: "Jueves", friday: "Viernes", saturday: "Sábado",
};

// Who may ask for each kind of data, read live from the broker with the member's identity.
type Readers = { availability: string[]; interests: string[]; health: string[]; agent: boolean; requests: OwnerPendingItem[] } | null;

async function readers(member: CastMember): Promise<Readers> {
  const owners = ownerClient();
  const principal = castPrincipal(member.id);
  try {
    const [view, vault, agents, pending] = await Promise.all([
      owners.contacts(principal), owners.vault(principal), owners.agents(principal), owners.pending(principal),
    ]);
    const giving = (category: "availability" | "interests") =>
      view.contacts.filter(({ gives }) => gives.includes(category)).map(({ address }) => address);
    return {
      availability: giving("availability"),
      interests: giving("interests"),
      health: vault.categories.find(({ name }) => name === healthCategory)?.members ?? [],
      agent: agents.some(({ agentId, wakeKind }) => agentId === principal.agentId && wakeKind !== "none"),
      requests: pending.filter(({ tool }) => tool === "vault_access"),
    };
  } catch (error) {
    getTelemetry().error("demo.cast.page", error, { userId: principal.userId });
    return null;
  }
}

function Section({ title, who, children }: { title: string; who: string[] | undefined; children: ReactNode }) {
  return <div className={who?.length ? "shared" : undefined}>
    <dt>{title}</dt>
    <dd>{children}</dd>
    <dd className="readers">{who?.length ? `Lo puede pedir ${who.join(", ")}` : "Nadie lo puede pedir"}</dd>
  </div>;
}

function Card({ member, live }: { member: CastMember; live: Readers }) {
  const days = weekdays.filter((day) => member.availability[day]);
  return <article className="cast-card">
    <header>
      <span className="avatar">{member.name[0]}</span>
      <div>
        <h2>{member.name}</h2>
        <code>{castAddress(member.id)}</code>
      </div>
      <span className="connection">
        <i className={live?.agent ? "online" : undefined} />
        {live === null ? "sin broker" : live.agent ? "agente conectado" : "sin agente"}
      </span>
    </header>
    <p className="cast-public"><small>Público</small>{member.headline}</p>
    <dl>
      <Section title={categories.availability.label} who={live?.availability}>
        {days.map((day) => <span key={day} className="line">
          {dayNames[day]}: {member.availability[day]!.length ? member.availability[day]!.join(", ") : "ocupado todo el día"}
        </span>)}
      </Section>
      <Section title={categories.interests.label} who={live?.interests}>
        <span className="chips">{member.interests.map((interest) => <span key={interest}>{interest}</span>)}</span>
      </Section>
      <Section title={`Bóveda · ${healthCategory}`} who={live?.health}>
        {member.health.map(({ label, value }) => <span key={label} className="line">{label}: {value}</span>)}
      </Section>
    </dl>
    {live?.requests.map((request) => request.tool === "vault_access" && <form key={request.requestId} action={decideForCast} className="cast-request">
      <p><strong>{request.from}</strong> pide leer «{request.args.categoryName}»</p>
      <input type="hidden" name="member" value={member.id} />
      <input type="hidden" name="requestId" value={request.requestId} />
      <button type="submit" name="kind" value="grant_vault_read">Conceder</button>
      <button type="submit" name="kind" value="deny">Rechazar</button>
    </form>)}
  </article>;
}

async function Cards() {
  await connection();
  const live = await Promise.all(cast.map(readers));
  const seeded = live.some((state) => state?.agent);
  return <>
    {!seeded && <p className="notice">Falta la seed: <code>pnpm agents:cast:seed tu-direccion@sideband.app</code></p>}
    <div className="cast-grid">
      {cast.map((member, index) => <Card key={member.id} member={member} live={live[index]} />)}
    </div>
  </>;
}

export default function CastPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="sideband-demo cast-page">
    <div className="cast-intro">
      <h1>Contactos de demostración</h1>
      <p>Cinco contactos ficticios. Lo público lo ve cualquiera. Lo privado lo responde el agente de cada uno, o lo lee el broker de su bóveda, solo si quien pregunta tiene permiso.</p>
      <ul>{tries.map((text) => <li key={text}>{text}</li>)}</ul>
    </div>
    <Suspense fallback={<p className="pending">Consultando el broker…</p>}>
      <Cards />
    </Suspense>
  </main>;
}
