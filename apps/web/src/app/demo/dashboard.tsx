"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { asRecord, formatSlot, identities, maxHistory, maxMessage, people, statuses, ChatReply, type ChatTurn, type ModelState, type Person, type ToolTrace } from "@/lib/demo";

type Message = { id: number; prompt: string; reply: ChatReply | null };
type Services = { api?: boolean; model?: ModelState; contacts?: boolean };

const suggestions: Record<Person, [string, string][]> = {
  ana: [["Consultar disponibilidad", "Hola, estoy organizando un partido. ¿Le acomoda a Bob el sábado a las seis de la tarde?"], ["Proponer un horario", "Invita a Bob y Carla a jugar el sábado. Propón las 4 o las 6 de la tarde como opciones."]],
  bob: [["Revisar mi bandeja", "¿Tengo alguna invitación pendiente?"], ["Responder con mi agenda", "Responde con mi disponibilidad al encuentro activo. Todavía no aceptes."]],
  carla: [["Revisar mi bandeja", "¿Qué encuentros tengo pendientes?"], ["Responder con mi agenda", "Cuéntales qué horas me sirven para el encuentro activo, sin aceptar todavía."]],
  eva: [["Probar los permisos", "¿Sabes si Bob tiene tiempo para fútbol el sábado a las 18?"], ["Conocer Sideband", "¿Cómo protege Sideband la privacidad de los calendarios?"]],
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
  const [anaMode, setAnaMode] = useState<"contacts" | "coordination">("contacts");
  const contactChat = person === "ana" && anaMode === "contacts";
  const conversation = contactChat ? "ana-contacts" : person;
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<Partial<Record<Person | "ana-contacts", Message[]>>>({});
  const [requests, setRequests] = useState<Partial<Record<Person, string>>>({});
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [services, setServices] = useState<Services | null>(null);
  const [refresh, setRefresh] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const refocus = useRef(false);
  const sequence = useRef(0);
  const messages = history[conversation];
  const ready = contactChat ? services?.contacts : services?.api && services.model === "ready";

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const response = await fetch(contactChat ? "/api/demo?mode=contacts" : "/api/demo", { signal: controller.signal });
        const state = await response.json();
        if (!controller.signal.aborted) setServices(state);
        if (response.ok) return;
      } catch {
        if (!controller.signal.aborted) setServices(contactChat ? { contacts: false } : { api: false, model: "offline" });
      }
      if (!controller.signal.aborted) timer = setTimeout(check, 8000);
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh, contactChat]);

  useEffect(() => {
    if (container.current) container.current.scrollTop = container.current.scrollHeight;
    if (refocus.current) {
      input.current?.focus();
      refocus.current = false;
    }
  }, [messages]);

  async function send(message: string) {
    const prompt = message.trim();
    if (!prompt || pending || !ready) return;
    const sender = person;
    const id = ++sequence.current;
    refocus.current = !messages?.length;
    const context: ChatTurn[] = (messages ?? []).filter(turn => turn.reply && !turn.reply.error)
      .slice(-maxHistory / 2).flatMap(({ prompt, reply }) => [
        { role: "user", content: prompt },
        // Reconsultar la API en lugar de dar al modelo resultados que pueden haber perdido permiso.
        { role: "assistant", content: previousAnswer(reply) },
      ]);
    setPending(true);
    setDraft("");
    setHistory(current => ({ ...current, [conversation]: [...(current[conversation] ?? []), { id, prompt, reply: null }] }));
    let reply: ChatReply;
    try {
      const response = await fetch("/api/demo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: sender, mode: contactChat ? "contacts" : "coordination", message: prompt, meetingId, requestId: requests[sender], history: context }),
      });
      reply = ChatReply.parse(await response.json());
      if (reply.error) {
        if (reply.modelState) setDraft(current => current || prompt);
        setRefresh(value => value + 1);
      }
      for (const { tool, data } of reply.traces ?? []) {
        if (typeof data.request_id === "string") {
          const requestId = data.request_id;
          setRequests(current => ({ ...current, [sender]: requestId }));
        }
        if (tool === "meeting_propose" && typeof data.id === "string") setMeetingId(data.id);
      }
    } catch {
      setServices(contactChat ? { contacts: false } : { api: false, model: "offline" });
      setRefresh(value => value + 1);
      reply = { error: "api", text: "No pude contactar el servidor local. Revisa la conexión e inténtalo de nuevo." };
    } finally {
      setPending(false);
    }
    setHistory(current => ({ ...current, [conversation]: current[conversation]?.map(item => item.id === id ? { ...item, reply } : item) }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  function composer() {
    return <>
      {!contactChat && meetingId && person !== "eva" && <p className="active-meeting">Encuentro activo <code>{meetingId.slice(0, 8)}</code></p>}
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="demo-message">Mensaje para Sideband</label>
        <textarea ref={input} id="demo-message" rows={2} value={draft} onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(draft);
            }
          }}
          placeholder="Escríbele a Sideband…" maxLength={maxMessage} />
        <button type="submit" className="send" aria-label="Enviar mensaje" disabled={!ready || pending || !draft.trim()}><Arrow up /></button>
      </form>
    </>;
  }

  const hasMessages = !!messages?.length;
  return <div className="sideband-demo">
    <aside className="sidebar">
      <div className="brand"><span className="mark"><Mark size={19} /></span>Sideband</div>
      <div className="identity-list" aria-label="Identidad activa">
        <p>Conversar como</p>
        {identities.map(id => <button type="button" key={id} aria-pressed={person === id} disabled={pending} onClick={() => { setPerson(id); setDraft(""); }}>
          <span className="avatar" aria-hidden="true">{people[id].name[0]}</span>{people[id].name}
          {id === "eva" && <small>Externa</small>}
        </button>)}
      </div>
      <p className="sidebar-note"><a href="/demo/elenco">Elenco de WhatsApp</a><br />Entorno local · Datos ficticios</p>
    </aside>

    <main className="main">
      <header className="header">
        {person === "ana" ? <select aria-label="Conversación de Ana" value={anaMode} disabled={pending}
          onChange={event => { setAnaMode(event.target.value === "contacts" ? "contacts" : "coordination"); setDraft(""); }}>
          <option value="contacts">Contactos de Ana</option>
          <option value="coordination">Fútbol del sábado</option>
        </select> : <p>Fútbol del sábado <span>· 28 nov · Santiago</span></p>}
        <button type="button" className="connection" onClick={() => setRefresh(value => value + 1)} title="Comprobar conexión">
          <i className={ready ? "online" : ""} />
          {!services || (contactChat ? services.contacts === undefined : services.model === undefined) ? "Conectando…" : ready ? "Agente listo" : contactChat ? "Agente sin conexión" : !services.api ? "API desconectada" : services.model === "missing" ? "Modelo no instalado" : "Ollama sin conexión"}
        </button>
      </header>
      {services && !ready && (contactChat ? services.contacts !== undefined : services.model !== undefined) && <p className="notice" role="status">
        {contactChat ? <>Inicia el broker local y prepara la agenda con <code>pnpm agents:contacts:seed</code>.</> : !services.api ? <>Levanta la API con <code>pnpm agents:up 3</code>.</>
          : services.model === "missing" ? "Ollama está conectado. Si el modelo se está descargando, el chat se habilitará al terminar. Si no, sigue los pasos del README."
            : "No hay conexión con Ollama. Inícialo siguiendo los pasos del README."}
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
          <p>{contactChat ? "Pregunta por un interés. Ana consultará a los agentes de su agenda." : person === "eva" ? "Puedes conversar con Sideband aunque no estés en el grupo de fútbol." : "Pregunta por un horario o coordina un encuentro. Escríbelo como se lo dirías a alguien."}</p>
          {composer()}
          <div className="suggestions" aria-label="Ideas para empezar">
            {(contactChat ? [["Preguntar por cerámica", "¿A alguien le interesa la cerámica?"], ["Ver mis contactos", "¿Quién está en mi agenda?"]] : suggestions[person]).map(([label, prompt]) => <button key={label} type="button" disabled={pending} onClick={() => {
              setDraft(prompt);
              input.current?.focus();
            }}>{label}<Arrow /></button>)}
          </div>
        </div>
      </div>}
    </main>
  </div>;
}

function previousAnswer(reply: ChatReply | null) {
  if (!reply?.traces?.length) return reply?.text ?? "";
  const queries = reply.traces.filter(({ tool }) => tool === "availability_check")
    .map(({ input }) => typeof input.recipient === "string" && typeof input.slot === "string"
      ? `${input.recipient} a las ${formatSlot(input.slot)} (Santiago)` : null).filter(Boolean);
  return queries.length ? `La pregunta anterior era por la disponibilidad de ${queries.join(", ")}.`
    : "Consulté el estado en Sideband.";
}
