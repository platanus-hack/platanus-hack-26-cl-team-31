"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { commands, formatSlot, identities, people, statuses, type ChatReply, type Person } from "@/lib/demo";

const glyphs = {
  logo: <><path d="m6 16 12-8M6 8l12 8"/><circle cx="6" cy="8" r="2.6"/><circle cx="18" cy="8" r="2.6"/><circle cx="6" cy="16" r="2.6"/><circle cx="18" cy="16" r="2.6"/></>,
  chat: <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.3-3A7.5 7.5 0 1 1 20 11.5Z"/>,
  send: <><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  shield: <><path d="m12 22 4-3a8 8 0 0 0 3-6V5l-7-3-7 3v8a8 8 0 0 0 3 6l4 3Z"/><path d="m9 12 2 2 4-4"/></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/></>,
  calendar: <><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 3v5m8-5v5M4 11h16m-11 5h2"/></>,
  sparkle: <><path d="M12 2c.8 6 3.2 8.3 9 10-5.8 1.7-8.2 4-9 10-.8-6-3.2-8.3-9-10 5.8-1.7 8.2-4 9-10Z"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.7 8.2a7 7 0 0 1 11.2-2.1L20 12m-16 0 3.1 5.9a7 7 0 0 0 11.2-2.1"/></>,
};

function Icon({ name, size = 17 }: { name: keyof typeof glyphs; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{glyphs[name]}</svg>;
}

type Message = { id: number; prompt: string; reply: ChatReply | null };
type PanelTab = "summary" | "json";

const quickActions = {
  ana: [["available", "¿Bob libre a las 18:00?"], ["busy", "¿Y a las 16:00?"], ["propose", "Proponer fútbol"]],
  bob: [["inbox", "Ver mi bandeja"], ["respond", "Responder con mi agenda"], ["revoke", "Revocar permiso"], ["restore", "Restaurar permiso"]],
  carla: [["inbox", "Ver mi bandeja"], ["respond", "Responder con mi agenda"]],
  eva: [["available", "¿Bob libre a las 18:00?"], ["busy", "¿Y a las 16:00?"]],
} as const;

const meetingActions = [
  ["get", "Ver estado"], ["accept", "Aceptar"], ["decline", "Rechazar"],
] as const;

const guide = [
  { person: "ana", text: "Consulta a Bob o propón fútbol." },
  { person: "bob", text: "Bob y Carla responden con su agenda." },
  { person: "carla", text: "Cada participante acepta el horario." },
  { person: "eva", text: "Prueba la misma consulta como Eva." },
] as const;

function Avatar({ person }: { person: Person }) {
  return <span className={`avatar avatar-${person}`} aria-hidden="true">{people[person].name[0]}</span>;
}

function ToolResult({ reply, tab, meetingId, onMeeting }: {
  reply?: ChatReply;
  tab: PanelTab;
  meetingId: string | null;
  onMeeting: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!reply?.data) return (
    <div className="result-empty">
      <span className="empty-icon"><Icon name="terminal" size={23} /></span>
      <strong>Aún no hay resultados</strong>
      <p>Envía un mensaje para inspeccionar lo que devuelve Nexo.</p>
    </div>
  );

  const { data } = reply;
  const raw = JSON.stringify(data, null, 2);
  const status = typeof data.status === "string" ? data.status : null;
  const time = typeof data.slot === "string" ? formatSlot(data.slot) : null;
  const id = typeof data.request_id === "string" ? data.request_id : typeof data.id === "string" ? data.id : null;
  const participants = Array.isArray(data.participants) ? data.participants : null;
  const inbox = Array.isArray(data.meetings) ? data.meetings : null;

  return (
    <div className="result-content">
      <div className="result-tool"><code>{reply.tool}</code>
        <button type="button" className="icon-button" title={copied ? "Copiado" : "Copiar JSON"} aria-label={copied ? "Copiado" : "Copiar JSON"} onClick={async () => {
          try { await navigator.clipboard.writeText(raw); setCopied(true); }
          catch { setCopied(false); }
        }}><Icon name="copy" size={15} /></button>
      </div>
      {tab === "json" ? <pre className="json-data">{raw}</pre> : (
        <>
          {status && <span className={`status-tag status-${status}`}>{statuses[status] ?? status}</span>}
          {inbox && <div className="inbox-results">
            {inbox.length === 0 && <p>Sin propuestas pendientes.</p>}
            {inbox.map(item => (
              <button key={item.id} type="button" onClick={() => onMeeting(item.id)} aria-pressed={meetingId === item.id}>
                <span>{statuses[item.status] ?? item.status}<small>{item.id.slice(0, 8)}</small></span>
                <Icon name="arrow" size={14} />
              </button>
            ))}
          </div>}
          <dl className="data-fields">
            {time && <><dt>Horario · Santiago</dt><dd>{time}</dd></>}
            {participants && <><dt>Participantes</dt><dd>{participants.map(p => people[p as Person]?.name ?? p).join(", ")}</dd></>}
            {typeof data.can_share === "boolean" && <><dt>Comparte disponibilidad</dt><dd>{data.can_share ? "Sí" : "No"}</dd></>}
            {id && <><dt>{data.request_id ? "ID de consulta" : "ID de encuentro"}</dt><dd><code>{id}</code></dd></>}
          </dl>
        </>
      )}
    </div>
  );
}

export function Dashboard() {
  const [person, setPerson] = useState<Person>("ana");
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<Partial<Record<Person, Message[]>>>({});
  const [requests, setRequests] = useState<Partial<Record<Person, string>>>({});
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>("summary");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [refresh, setRefresh] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const messages = history[person];
  const latest = messages?.findLast(message => message.reply?.tool);
  const actions: ReadonlyArray<readonly [keyof typeof commands, string]> = [
    ...quickActions[person],
    ...(requests[person] ? [["saved", "Consulta anterior"]] as const : []),
    ...(meetingId && person !== "eva" ? meetingActions : []),
  ];

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/demo", { signal: controller.signal })
      .then(response => setReady(response.ok))
      .catch(() => { if (!controller.signal.aborted) setReady(false); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [messages]);

  function switchPerson(next: Person) {
    setPerson(next);
    setDraft("");
  }

  async function send(message: string) {
    const prompt = message.trim();
    if (!prompt || pending) return;
    const sender = person;
    const id = ++sequence.current;
    setPending(true);
    setDraft("");
    setHistory(current => ({ ...current, [sender]: [...(current[sender] ?? []), { id, prompt, reply: null }] }));

    let reply: ChatReply;
    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: sender, message: prompt, meetingId, requestId: requests[sender] }),
      });
      reply = await response.json();
      if (response.status >= 500) setReady(false);
      else if (reply.data) setReady(true);
      if (typeof reply.data?.request_id === "string") {
        const requestId = reply.data.request_id;
        setRequests(current => ({ ...current, [sender]: requestId }));
      }
      if (reply.tool === "meeting_propose" && typeof reply.data?.id === "string") {
        setMeetingId(reply.data.id);
      }
    } catch {
      setReady(false);
      reply = { text: "No pude contactar el servidor local. Revisa la conexión e inténtalo otra vez." };
    } finally {
      setPending(false);
    }
    setHistory(current => ({ ...current, [sender]: current[sender]?.map(item => item.id === id ? { ...item, reply } : item) }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><span className="brand-mark"><Icon name="logo" size={22} /></span><span>Nexo<span className="brand-dot">.</span></span></div>
          <span className="topbar-divider" />
          <span className="topbar-label">Laboratorio de coordinación</span>
          <button type="button" className="connection" title="Comprobar conexión" onClick={() => setRefresh(value => value + 1)}>
            <span className={`dot ${ready === true ? "online" : ready === false ? "offline" : ""}`} />
            {ready === true ? "API conectada" : ready === false ? "API desconectada" : "Conectando…"}
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </header>

      <main className="workspace">
        <div className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> DEMO INTERACTIVA</div>
            <h1>Coordina sin exponer<br className="hero-break" /> tu calendario<span>.</span></h1>
            <p>Prueba cómo distintos asistentes consultan disponibilidad, negocian un horario y confirman un encuentro sin ver las agendas de los demás.</p>
          </div>
          <div className="scenario"><span className="scenario-icon"><Icon name="calendar" size={22} /></span><div><span>ESCENARIO DE PRUEBA</span><strong>Fútbol del sábado</strong><small>28 nov 2026 · Santiago, Chile</small></div></div>
        </div>

        {ready === false && <p className="connection-notice" role="status">No se pudo conectar. Ejecuta <code>pnpm agents:up 3</code> desde la raíz y vuelve a comprobar la conexión.</p>}

        <div className="dashboard-grid">
          <aside className="identities panel" aria-labelledby="identity-heading">
            <div className="side-heading"><span className="overline">01 / IDENTIDADES</span><h2 id="identity-heading">Actúa como</h2><p>Cada persona ve solo lo que puede consultar.</p></div>
            <div className="identity-list">
              {identities.map(id => (
                <button key={id} type="button" className="identity" aria-pressed={person === id} disabled={pending} onClick={() => switchPerson(id)}>
                  <Avatar person={id} />
                  <span className="identity-info"><strong>{people[id].name}</strong><small>{people[id].role}</small></span>
                  {person === id && <span className="identity-indicator" />}
                </button>
              ))}
            </div>
            <div className="privacy-note"><Icon name="shield" /><span><strong>Solo datos de prueba</strong><small>No se conecta a calendarios reales.</small></span></div>
          </aside>

          <section className="chat panel" aria-labelledby="chat-heading">
            <div className="chat-heading"><span className="chat-icon"><Icon name="chat" /></span><div><h2 id="chat-heading">Chat de coordinación</h2><p>Conversando como <strong>{people[person].name}</strong></p></div><span className="mode-tag">MODO DEMO</span></div>
            <div className="chat-body" ref={container} role="log" aria-label={`Conversación de ${people[person].name}`}>
              <div className="chat-date"><span>SÁBADO 28 NOV</span></div>
              <Bubble>Hola, {people[person].name}. {person === "eva" ? "No perteneces al grupo Fútbol. Prueba la misma consulta que Ana para ver qué información puedes obtener." : "Puedes consultar quién está libre para el partido, revisar tu bandeja o coordinar el horario con los demás."}</Bubble>
              {messages?.map(({ id, prompt, reply }) => (
                <div key={id} className="exchange">
                  <div className="message user-message"><span>{prompt}</span><Avatar person={person} /></div>
                  <Bubble tool={reply?.tool}>{reply?.text ?? "Consultando a Nexo…"}</Bubble>
                </div>
              ))}
            </div>
            <div className="composer">
              <div className="suggestions" aria-label="Comandos sugeridos">
                {actions.map(([command, label]) => <button type="button" key={command} disabled={pending} onClick={() => void send(commands[command])}>{label}</button>)}
              </div>
              {meetingId && person !== "eva" && <p className="active-meeting">Encuentro activo <code>{meetingId.slice(0, 8)}</code></p>}
              <form onSubmit={submit}>
                <label className="sr-only" htmlFor="demo-message">Mensaje para Nexo</label>
                <input id="demo-message" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Pregúntale algo a Nexo…" maxLength={400} autoComplete="off" />
                <button type="submit" className="send" aria-label="Enviar mensaje" disabled={pending || !draft.trim()}><Icon name="send" size={20} /></button>
              </form>
            </div>
          </section>

          <aside className="right-rail">
            <section className="panel inspector" aria-labelledby="inspector-heading">
              <div className="side-heading"><span className="overline">02 / RESULTADOS</span><h2 id="inspector-heading">Inspector de datos</h2><p>Última respuesta para {people[person].name}.</p></div>
              <div className="tabs" aria-label="Formato de datos">
                <button type="button" aria-pressed={tab === "summary"} onClick={() => setTab("summary")}>Resumen</button>
                <button type="button" aria-pressed={tab === "json"} onClick={() => setTab("json")}>JSON</button>
              </div>
              <ToolResult key={`${person}-${latest?.id}`} reply={latest?.reply ?? undefined} tab={tab} meetingId={meetingId} onMeeting={setMeetingId} />
            </section>
            <section className="panel guide" aria-labelledby="guide-heading">
              <div className="guide-title"><Icon name="sparkle" /><h2 id="guide-heading">Prueba el flujo</h2></div>
              <ol>{guide.map(({ person: next, text }, index) => (
                <li key={next}><button type="button" disabled={pending} onClick={() => switchPerson(next)}><span>{index + 1}</span>{text}</button></li>
              ))}</ol>
            </section>
          </aside>
        </div>

        <footer><span>NEXO <span>·</span> PLATANUS HACK 2026</span><span><Icon name="terminal" size={14} /> Chat con comandos guiados · API local</span></footer>
      </main>
    </div>
  );
}

function Bubble({ children, tool }: { children: ReactNode; tool?: string }) {
  return <div className="message agent-message"><span className="message-icon"><Icon name="logo" size={17} /></span><div><strong>Nexo</strong><div className="bubble"><p>{children}</p>{tool && <code className="tool-chip">{tool}</code>}</div></div></div>;
}
