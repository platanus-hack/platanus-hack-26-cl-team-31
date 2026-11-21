import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "../(app)/brand";
import { AgentFlowSection } from "./agent-flow-section";
import { button, card, primaryButton, secondaryText, textLink } from "../(app)/ui";

// Public landing. proxy.ts shows it at "/" to visitors without a session; it is fully static.

const repoUrl = "https://github.com/platanus-hack/platanus-hack-26-cl-team-31";
const demoUrl = `${repoUrl}#dashboard-con-chat`;

export const metadata: Metadata = {
  title: "Sideband · Asistentes que coordinan respetando permisos",
  description: "Asistentes de IA que coordinan con tus contactos respetando sus permisos.",
};

const label = "font-mono text-[11px] uppercase tracking-[0.08em] text-muted";
const sectionTitle = "text-[26px] leading-[1.15] font-medium tracking-[-0.02em] sm:text-[32px]";

const problems = [
  {
    title: "Coordinar hoy es ir y venir",
    body: "¿Quién se suma el sábado? ¿A quién le interesa la cerámica? Hoy son mensajes uno por uno, esperas y respuestas que se cruzan.",
  },
  {
    title: "Dejar que los agentes hablen sin reglas expone tus datos",
    body: "Un asistente con acceso a tu calendario puede contar más de lo necesario si otro agente se lo pide. Una pregunta inocente puede terminar mostrando tu agenda completa.",
  },
];

const proposal = [
  {
    title: "Permisos por contacto y por categoría",
    body: "Eliges qué compartes con cada contacto: Disponibilidad horaria, Intereses, Salud o Preguntas abiertas. Al conectar vienen marcadas solo Disponibilidad e Intereses.",
  },
  {
    title: "Círculos para grupos",
    body: "Los miembros de un círculo se dan lo básico mientras estén dentro. Cada invitado acepta antes de entrar, y al salir se cierran las solicitudes que quedan sin permiso.",
  },
  {
    title: "Tú tienes la última palabra",
    body: "Solo tú aceptas un contacto, cambias o revocas un permiso cuando quieras y apruebas desde Inicio las solicitudes que esperan tu decisión.",
  },
];

const steps = [
  { title: "Crea tu dirección", body: "Entras con Google y eliges tu dirección Sideband, del tipo nombre@dominio." },
  { title: "Conecta tu asistente", body: "Lo autorizas por OAuth y revisas en una pantalla de consentimiento qué puede hacer en tu nombre." },
  { title: "Invita a tus contactos", body: "La conexión es mutua. Cada uno elige qué categorías le comparte al otro." },
  {
    title: "Tu asistente pregunta",
    body: "El broker de Sideband revisa el permiso, avisa al asistente de tu contacto y te devuelve solo lo permitido. Sin permiso, la denegación llega firmada, sin motivo, y tu contacto ni siquiera recibe el aviso.",
  },
];

const guardrails = [
  { title: "El servidor decide", body: "Los permisos se verifican en el broker, no en los agentes. La identidad de quien pregunta sale de su token, nunca del mensaje." },
  { title: "Solo viaja lo mínimo", body: "Cada respuesta lleva únicamente los campos que permite la categoría: si estás libre y tus bloques libres, nunca el detalle de tu calendario." },
  { title: "Respuestas saneadas", body: "Antes de viajar, cada respuesta de un agente se valida y se filtra. Se bloquean pistas privadas, correos, teléfonos, URLs y ecos de instrucciones inyectadas." },
  { title: "Firmado y sin contenido en los avisos", body: "Las respuestas finales y las denegaciones van firmadas. El aviso al otro asistente lleva solo un identificador, y el mensaje del remitente se marca como no confiable." },
  { title: "Se comprueba otra vez al entregar", body: "Antes de entregar una respuesta, el broker comprueba que sigas compartiendo esa categoría. Si ya no, la entrega se bloquea." },
  { title: "Todo queda a la vista", body: "En Actividad y El cable ves qué te preguntaron, quién lo hizo y cómo terminó cada solicitud." },
];

const channels = [
  { name: "Claude Code y Codex", body: "Por MCP con OAuth." },
  { name: "WhatsApp", body: "Vinculas tu teléfono y usas Sideband desde el chat." },
  { name: "Dot", body: "Como plugin de ChatGPT con eventos MCP." },
  { name: "Grok Bot", body: "Por HTTPS, con avisos en una rutina." },
  { name: "OpenClaw", body: "Conectas tu gateway y recibes avisos en el agente main." },
];

function Section({ id, eyebrow, title, intro, children }: { id: string; eyebrow: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t border-line py-16 sm:py-20">
      <p className={label}>{eyebrow}</p>
      <h2 id={`${id}-title`} className={`${sectionTitle} mt-3 max-w-2xl`}>{title}</h2>
      {intro && <p className="mt-4 max-w-2xl text-[15px] leading-[24px] text-muted">{intro}</p>}
      <div className="mt-10">{children}</div>
    </section>
  );
}

function ExampleExchange() {
  return (
    <figure className={`${card} p-3`}>
      <div className="rounded-[14px] stage p-5 sm:p-6">
        <figcaption className={label}>Ejemplo</figcaption>
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-2xl bg-chip p-4">
            <p className="font-mono text-xs text-muted">ana@sideband → bob@sideband</p>
            <p className="mt-2 text-ink">¿Bob puede el sábado a las 11:00, por una hora?</p>
            <p className="mt-3 inline-flex h-[22px] items-center rounded-full bg-info-bg px-2.5 text-[11px] font-medium text-info">Disponibilidad horaria</p>
          </div>
          <div className="rounded-2xl bg-chip p-4">
            <p className="font-mono text-xs text-muted">Respuesta que llega a Ana</p>
            <p className="mt-2 text-ink">Ocupado. Libre de 12:00 a 12:30 y de 15:00 a 15:30.</p>
            <p className="mt-3 inline-flex h-[22px] items-center rounded-full bg-success-bg px-2.5 text-[11px] font-medium text-success">Permitido · firmado</p>
          </div>
          <p className="px-1 text-[13px] leading-relaxed text-muted">
            No viaja: con quién se junta Bob, dónde ni el título de sus eventos.
          </p>
        </div>
      </div>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-canvas font-sans text-ink">
      <a href="#contenido" className="sr-only rounded-full bg-card px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:z-30 focus:m-3">Saltar al contenido</a>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1056px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Sideband, inicio" className="rounded-full"><Brand /></Link>
          <nav aria-label="Secciones" className="flex items-center gap-1">
            <a href="#como-funciona" className="hidden h-9 items-center rounded-full px-3.5 text-[13px] font-medium text-nav transition-colors hover:bg-white/6 hover:text-ink sm:inline-flex">Cómo funciona</a>
            <a href="#en-vivo" className="hidden h-9 items-center rounded-full px-3.5 text-[13px] font-medium text-nav transition-colors hover:bg-white/6 hover:text-ink sm:inline-flex">En vivo</a>
            <a href="#privacidad" className="hidden h-9 items-center rounded-full px-3.5 text-[13px] font-medium text-nav transition-colors hover:bg-white/6 hover:text-ink sm:inline-flex">Privacidad</a>
            <Link href="/sign-in" prefetch={false} className={`${button} ml-2`}>Entrar</Link>
          </nav>
        </div>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-[1056px] px-4 sm:px-6">
        <section aria-labelledby="hero-title" className="grid items-center gap-12 pt-14 pb-16 sm:pt-20 sm:pb-20 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className={label}>Platanus Hack 26</p>
            <h1 id="hero-title" className="mt-4 text-[38px] leading-[1.05] font-medium tracking-[-0.03em] sm:text-[52px]">
              Tu asistente coordina. Tus contactos deciden qué comparten.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-[27px] text-body">
              Sideband conecta tu asistente de IA con los asistentes de tus contactos para encontrar intereses en común y coordinar encuentros. Cada persona decide quién puede consultarla y sobre qué, y solo viaja lo que permitió.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/sign-in" prefetch={false} className={`${primaryButton} h-10 px-5 text-sm`}>Entrar</Link>
              <a href={demoUrl} className={`${button} h-10 px-5 text-sm`}>Ver la demo <span aria-hidden="true">↗</span></a>
            </div>
            <p className="mt-3 text-[13px] text-muted">La demo corre en local con contactos ficticios.</p>
          </div>
          <ExampleExchange />
        </section>

        <Section id="problema" eyebrow="El problema" title="Coordinar con otros sigue siendo manual, y automatizarlo mal es peor">
          <ul className="grid gap-4 md:grid-cols-2">
            {problems.map((item) => (
              <li key={item.title} className={`${card} p-6`}>
                <h3 className="text-[15px] font-medium tracking-[-0.01em]">{item.title}</h3>
                <p className={`${secondaryText} mt-2`}>{item.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="propuesta"
          eyebrow="Nuestra propuesta"
          title="Asistentes que conversan a través de Sideband, con las reglas de cada persona"
          intro="Tu asistente no habla directo con el de tu contacto. Pregunta a Sideband, que aplica los permisos que tu contacto definió y entrega solo la respuesta permitida."
        >
          <ul className="grid gap-4 md:grid-cols-3">
            {proposal.map((item) => (
              <li key={item.title} className={`${card} p-6`}>
                <h3 className="text-[15px] font-medium tracking-[-0.01em]">{item.title}</h3>
                <p className={`${secondaryText} mt-2`}>{item.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="como-funciona" eyebrow="Cómo funciona" title="Cuatro pasos">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step.title} className={`${card} flex flex-col p-6`}>
                <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-full bg-accent-soft font-mono text-[13px] text-accent-ink">{index + 1}</span>
                <h3 className="mt-4 text-[15px] font-medium tracking-[-0.01em]">{step.title}</h3>
                <p className={`${secondaryText} mt-2`}>{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="en-vivo"
          eyebrow="En vivo"
          title="Así conversan los agentes a través de Sideband"
          intro="Una red de ejemplo que crece mientras conversa: una pregunta permitida, una denegada, una respuesta bloqueada por filtrar datos, una que espera la decisión de su titular, y personas que se unen y se van. Cada paso muestra solo metadatos: la herramienta, la categoría, la decisión y la regla, nunca el contenido."
        >
          <AgentFlowSection />
          <p className="mt-4 text-[13px] text-muted">
            Haz clic en un paso de la línea de tiempo para repetirlo. Los datos son ficticios; en la demo, el mismo grafo muestra en vivo la telemetría del broker desde el panel de administración.{" "}
            <Link href="/embed/flujo" prefetch={false} className={textLink}>Abrir a pantalla completa <span aria-hidden="true">↗</span></Link>
          </p>
        </Section>

        <Section
          id="privacidad"
          eyebrow="Privacidad y resguardos"
          title="Las reglas se aplican en el servidor, no se le piden al agente"
          intro="Un agente puede equivocarse o ser manipulado. Por eso cada solicitud pasa por el broker, que decide y filtra antes de que algo salga."
        >
          <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {guardrails.map((item) => (
              <li key={item.title} className="border-l border-line-strong pl-4">
                <h3 className="text-[15px] font-medium tracking-[-0.01em]">{item.title}</h3>
                <p className={`${secondaryText} mt-2`}>{item.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="canales"
          eyebrow="Canales"
          title="Conecta el asistente que ya usas"
          intro="La app incluye una guía de conexión para cada uno."
        >
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {channels.map((channel) => (
              <li key={channel.name} className={`${card} p-5`}>
                <h3 className="text-sm font-medium">{channel.name}</h3>
                <p className={`${secondaryText} mt-1.5`}>{channel.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        <section aria-labelledby="cta-title" className="border-t border-line py-16 sm:py-20">
          <div className={`${card} flex flex-col items-start gap-6 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10`}>
            <div>
              <h2 id="cta-title" className="text-[22px] leading-tight font-medium tracking-[-0.02em]">Decide qué puede contar tu asistente</h2>
              <p className={`${secondaryText} mt-2`}>Entra con Google, crea tu dirección y conecta tu primer agente.</p>
            </div>
            <Link href="/sign-in" prefetch={false} className={`${primaryButton} h-10 shrink-0 px-5 text-sm`}>Entrar a Sideband</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1056px] flex-col gap-3 px-4 py-8 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Sideband · Equipo 31 · Platanus Hack 26</p>
          <a href={repoUrl} className={textLink}>Código en GitHub <span aria-hidden="true">↗</span></a>
        </div>
      </footer>
    </div>
  );
}
