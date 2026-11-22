"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { asRecord, formatSlot, identities, maxMessage, people, statuses, type Person, type ToolTrace } from "@/lib/demo";
import { useDemoChat, type Message } from "./use-demo-chat";
import type { DemoMode } from "./use-demo-connection";

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

function Composer({ input, draft, setDraft, meetingId, available, onSend }: {
  input: RefObject<HTMLTextAreaElement | null>; draft: string; setDraft: (text: string) => void;
  meetingId: string | null; available: boolean; onSend: (prompt: string) => void;
}) {
  const prompt = draft.trim();
  const canSend = available && !!prompt;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSend) onSend(prompt);
  }

  return <>
    {meetingId && <p className="active-meeting">Encuentro activo <code>{meetingId.slice(0, 8)}</code></p>}
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="demo-message">Mensaje para Sideband</label>
      <textarea ref={input} id="demo-message" rows={2} value={draft} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder="Escríbele a Sideband…" maxLength={maxMessage} />
      <button type="submit" className="send" aria-label="Enviar mensaje" disabled={!canSend}><Arrow up /></button>
    </form>
  </>;
}

function Transcript({ messages, person, meetingId, onMeeting }: {
  messages: Message[]; person: Person; meetingId: string | null; onMeeting: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [messages]);
  return <div className="thread" ref={container} role="log" aria-label={`Conversación de ${people[person].name}`}>
    <div className="conversation">
      {messages.map(({ id, prompt, reply }) => <div className="exchange" key={id}>
        <p className="user-message">{prompt}</p>
        <div className="agent-message">
          <span className="mark agent-mark"><Mark size={16} /></span>
          <div className="agent-content">
            <p className={reply ? "reply" : "reply pending"}>{reply?.text ?? "Consultando…"}</p>
            {!!reply?.traces?.length && <ToolDetails traces={reply.traces} meetingId={meetingId} onMeeting={onMeeting} />}
          </div>
        </div>
      </div>)}
    </div>
  </div>;
}

function Welcome({ person, contactChat, pending, onSuggest, children }: {
  person: Person; contactChat: boolean; pending: boolean; onSuggest: (prompt: string) => void; children: ReactNode;
}) {
  return <div className="welcome">
    <div className="chat-width welcome-inner">
      <div className="welcome-title"><span className="welcome-mark"><Mark size={34} /></span><h1>Hola, {people[person].name}.</h1></div>
      <p>{contactChat ? "Pregunta por un interés. Ana consultará a los agentes de su agenda." : person === "eva" ? "Puedes conversar con Sideband aunque no estés en el grupo de fútbol." : "Pregunta por un horario o coordina un encuentro. Escríbelo como se lo dirías a alguien."}</p>
      {children}
      <div className="suggestions" aria-label="Ideas para empezar">
        {(contactChat ? [["Preguntar por cerámica", "¿A alguien le interesa la cerámica?"], ["Ver mis contactos", "¿Quién está en mi agenda?"]] : suggestions[person]).map(([label, prompt]) => <button key={label} type="button" disabled={pending} onClick={() => onSuggest(prompt)}>{label}<Arrow /></button>)}
      </div>
    </div>
  </div>;
}

export function Dashboard() {
  const [person, setPerson] = useState<Person>("ana");
  const [anaMode, setAnaMode] = useState<DemoMode>("contacts");
  const mode = person === "ana" ? anaMode : "coordination";
  const contactChat = mode === "contacts";
  const { connection, draft, setDraft, messages, meetingId, setMeetingId, pending, send } = useDemoChat(person, mode);
  const input = useRef<HTMLTextAreaElement>(null);
  const refocus = useRef(false);
  const hasMessages = !!messages?.length;

  useEffect(() => {
    if (refocus.current) {
      input.current?.focus();
      refocus.current = false;
    }
  }, [messages]);

  const composer = <Composer input={input} draft={draft} setDraft={setDraft} available={connection.ready && !pending}
    meetingId={contactChat || person === "eva" ? null : meetingId} onSend={prompt => {
      refocus.current = !hasMessages;
      void send(prompt);
    }} />;
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
      <p className="sidebar-note"><a href="/demo/elenco">Contactos de demostración</a><br />Entorno local · Datos ficticios</p>
    </aside>

    <main className="main">
      <header className="header">
        {person === "ana" ? <select aria-label="Conversación de Ana" value={anaMode} disabled={pending}
          onChange={event => { setAnaMode(event.target.value === "contacts" ? "contacts" : "coordination"); setDraft(""); }}>
          <option value="contacts">Contactos de Ana</option>
          <option value="coordination">Fútbol del sábado</option>
        </select> : <p>Fútbol del sábado <span>· 28 nov · Santiago</span></p>}
        <button type="button" className="connection" onClick={connection.refresh} title="Comprobar conexión">
          <i className={connection.ready ? "online" : ""} />
          {connection.label}
        </button>
      </header>
      {connection.notice && <p className="notice" role="status">{connection.notice}</p>}

      {hasMessages ? <>
        <Transcript messages={messages} person={person} meetingId={meetingId} onMeeting={setMeetingId} />
        <div className="bottom"><div className="chat-width">{composer}<p className="footnote">Agente local · Las herramientas respetan los permisos de cada identidad</p></div></div>
      </> : <Welcome person={person} contactChat={contactChat} pending={pending} onSuggest={prompt => {
        setDraft(prompt);
        input.current?.focus();
      }}>{composer}</Welcome>}
    </main>
  </div>;
}
