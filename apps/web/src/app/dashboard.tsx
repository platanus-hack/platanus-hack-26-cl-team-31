"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { asRecord, formatSlot, identities, maxHistory, maxMessage, people, statuses, type ChatReply, type ChatTurn, type Person, type ToolTrace } from "@/lib/demo";

type Message = { id: number; prompt: string; reply: ChatReply | null };
type Services = { api: boolean; model: boolean };

const suggestions: Record<Person, [string, string][]> = {
  ana: [["Consultar disponibilidad", "Hola, estoy organizando un partido. ¿Le acomoda a Bob el sábado a las seis de la tarde?"], ["Proponer un horario", "Invita a Bob y Carla a jugar el sábado. Propón las 4 o las 6 de la tarde como opciones."]],
  bob: [["Revisar mi bandeja", "¿Tengo alguna invitación pendiente?"], ["Responder con mi agenda", "Responde con mi disponibilidad al encuentro activo. Todavía no aceptes."]],
  carla: [["Revisar mi bandeja", "¿Qué encuentros tengo pendientes?"], ["Responder con mi agenda", "Cuéntales qué horas me sirven para el encuentro activo, sin aceptar todavía."]],
  eva: [["Probar los permisos", "¿Sabes si Bob tiene tiempo para fútbol el sábado a las 18?"], ["Conocer Nexo", "¿Cómo protege Nexo la privacidad de los calendarios?"]],
};

function Mark({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" />
  </svg>;
}

function Arrow({ up = false }: { up?: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={up ? "M12 19V5m-6 6 6-6 6 6" : "M5 12h14m-6-6 6 6-6 6"} />
  </svg>;
}

function ToolDetails({ traces, meetingId, onMeeting }: {
  traces: ToolTrace[]; meetingId: string | null; onMeeting: (id: string) => void;
}) {
  const [copied, setCopied] = useState<number | null>(null);
  return <details className="inspect">
    <summary>{traces.length === 1 ? "Ver datos · 1 herramienta" : `Ver datos · ${traces.length} herramientas`}</summary>
    {traces.map(({ tool, input, data }, index) => {
      const raw = JSON.stringify(data, null, 2);
      const status = typeof data.status === "string" ? statuses[data.status] ?? data.status : null;
      const inbox = Array.isArray(data.meetings) ? data.meetings.map(asRecord) : [];
      const slot = data.slot ?? input.slot;
      const time = typeof slot === "string" ? formatSlot(slot) : null;
      return <div key={index} className="trace">
        <div className="trace-head">
          <code>{tool}</code>
          {status && <span>{status}</span>}
          <button type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(raw); setCopied(index); }
            catch { setCopied(null); }
          }}>{copied === index ? "Copiado" : "Copiar JSON"}</button>
        </div>
        {time && <p className="trace-time">{time} · Santiago</p>}
        {inbox.map(item => {
          const id = item?.id;
          if (typeof id !== "string") return null;
          return <button className="inbox-item" type="button" key={id} onClick={() => onMeeting(id)} aria-pressed={id === meetingId}>
            {item?.status ? statuses[String(item.status)] ?? String(item.status) : "Encuentro"} <code>{id.slice(0, 8)}</code><Arrow />
          </button>;
        })}
        <pre aria-label={`JSON de ${tool}`}>{raw}</pre>
      </div>;
    })}
  </details>;
}

export function Dashboard() {
  const [person, setPerson] = useState<Person>("ana");
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<Partial<Record<Person, Message[]>>>({});
  const [requests, setRequests] = useState<Partial<Record<Person, string>>>({});
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [services, setServices] = useState<Services | null>(null);
  const [refresh, setRefresh] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const refocus = useRef(false);
  const sequence = useRef(0);
  const messages = history[person];

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/demo", { signal: controller.signal })
      .then(async response => setServices(await response.json()))
      .catch(() => { if (!controller.signal.aborted) setServices({ api: false, model: false }); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (container.current) container.current.scrollTop = container.current.scrollHeight;
    if (refocus.current) {
      input.current?.focus();
      refocus.current = false;
    }
  }, [messages]);

  async function send(message: string) {
    const prompt = message.trim();
    if (!prompt || pending) return;
    const sender = person;
    const id = ++sequence.current;
    refocus.current = !messages?.length;
    const context: ChatTurn[] = (messages ?? []).filter(turn => turn.reply && !turn.reply.error)
      .slice(-maxHistory / 2).flatMap(({ prompt, reply }) => [
        { role: "user", content: prompt },
        // Reconsultar la API en lugar de dar al modelo resultados que pueden haber perdido permiso.
        { role: "assistant", content: reply?.traces?.length
          ? "Consulté el estado en Nexo; debo volver a consultar para dar datos actuales."
          : reply?.text ?? "" },
      ]);
    setPending(true);
    setDraft("");
    setHistory(current => ({ ...current, [sender]: [...(current[sender] ?? []), { id, prompt, reply: null }] }));
    let reply: ChatReply;
    try {
      const response = await fetch("/api/demo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: sender, message: prompt, meetingId, requestId: requests[sender], history: context }),
      });
      reply = await response.json();
      if (reply.error) {
        const service = reply.error;
        setServices(current => ({ api: true, model: true, ...current, [service]: false }));
      } else if (response.ok) setServices({ api: true, model: true });
      for (const { tool, data } of reply.traces ?? []) {
        if (typeof data.request_id === "string") {
          const requestId = data.request_id;
          setRequests(current => ({ ...current, [sender]: requestId }));
        }
        if (tool === "meeting_propose" && typeof data.id === "string") setMeetingId(data.id);
      }
    } catch {
      setServices({ api: false, model: false });
      reply = { error: "api", text: "No pude contactar el servidor local. Revisa la conexión e inténtalo de nuevo." };
    } finally {
      setPending(false);
    }
    setHistory(current => ({ ...current, [sender]: current[sender]?.map(item => item.id === id ? { ...item, reply } : item) }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  function composer() {
    return <>
      {meetingId && person !== "eva" && <p className="active-meeting">Encuentro activo <code>{meetingId.slice(0, 8)}</code></p>}
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="demo-message">Mensaje para Nexo</label>
        <textarea ref={input} id="demo-message" rows={2} value={draft} onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(draft);
            }
          }}
          placeholder="Escríbele a Nexo…" maxLength={maxMessage} />
        <button type="submit" className="send" aria-label="Enviar mensaje" disabled={pending || !draft.trim()}><Arrow up /></button>
      </form>
    </>;
  }

  const hasMessages = !!messages?.length;
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="mark"><Mark size={19} /></span>Nexo</div>
      <div className="identity-list" aria-label="Identidad activa">
        <p>Conversar como</p>
        {identities.map(id => <button type="button" key={id} aria-pressed={person === id} disabled={pending} onClick={() => { setPerson(id); setDraft(""); }}>
          <span className="avatar" aria-hidden="true">{people[id].name[0]}</span>{people[id].name}
          {id === "eva" && <small>Externa</small>}
        </button>)}
      </div>
      <p className="sidebar-note">Entorno local · Datos ficticios</p>
    </aside>

    <main className="main">
      <header className="header">
        <p>Fútbol del sábado <span>· 28 nov · Santiago</span></p>
        <button type="button" className="connection" onClick={() => setRefresh(value => value + 1)} title="Comprobar conexión">
          <i className={services?.api && services.model ? "online" : ""} />
          {!services ? "Conectando…" : services.api && services.model ? "Agente listo" : !services.api ? "API desconectada" : "Modelo sin conexión"}
        </button>
      </header>
      {services && (!services.api || !services.model) && <p className="notice" role="status">
        {!services.api ? <>Levanta la API con <code>pnpm agents:up 3</code>.</> : <>Arranca Ollama y descarga el modelo de la demo. Las instrucciones están en el README.</>}
      </p>}

      {hasMessages ? <>
        <div className="thread" ref={container} role="log" aria-label={`Conversación de ${people[person].name}`}>
          <div className="conversation">
            {messages.map(({ id, prompt, reply }) => <div className="exchange" key={id}>
              <p className="user-message">{prompt}</p>
              <div className="agent-message">
                <span className="mark agent-mark"><Mark size={16} /></span>
                <div className="agent-content">
                  <p className={reply ? "reply" : "reply pending"}>{reply?.text ?? "Consultando…"}</p>
                  {!!reply?.traces?.length && <ToolDetails traces={reply.traces} meetingId={meetingId} onMeeting={setMeetingId} />}
                </div>
              </div>
            </div>)}
          </div>
        </div>
        <div className="bottom"><div className="chat-width">{composer()}<p className="footnote">Agente local · Las herramientas respetan los permisos de cada identidad</p></div></div>
      </> : <div className="welcome">
        <div className="chat-width welcome-inner">
          <div className="welcome-title"><span className="welcome-mark"><Mark size={34} /></span><h1>Hola, {people[person].name}.</h1></div>
          <p>{person === "eva" ? "Puedes conversar con Nexo aunque no estés en el grupo de fútbol." : "Pregunta por un horario o coordina un encuentro. Escríbelo como se lo dirías a alguien."}</p>
          {composer()}
          <div className="suggestions" aria-label="Ideas para empezar">
            {suggestions[person].map(([label, prompt]) => <button key={label} type="button" disabled={pending} onClick={() => {
              setDraft(prompt);
              input.current?.focus();
            }}>{label}<Arrow /></button>)}
          </div>
        </div>
      </div>}
    </main>
  </div>;
}
