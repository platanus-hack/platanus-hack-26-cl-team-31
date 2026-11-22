import { useRef, useState } from "react";
import { ChatReply, formatSlot, maxHistory, type ChatTurn, type Person, type ToolTrace } from "@/lib/demo";
import { useDemoConnection, type DemoMode } from "./use-demo-connection";

export type Message = { id: number; prompt: string; reply: ChatReply | null };
type Conversation = Person | "ana-contacts";

function previousAnswer(reply: ChatReply | null) {
  if (!reply?.traces?.length) return reply?.text ?? "";
  const queries = reply.traces.filter(({ tool }) => tool === "availability_check")
    .map(({ input }) => typeof input.recipient === "string" && typeof input.slot === "string"
      ? `${input.recipient} a las ${formatSlot(input.slot)} (Santiago)` : null).filter(Boolean);
  return queries.length ? `La pregunta anterior era por la disponibilidad de ${queries.join(", ")}.`
    : "Consulté el estado en Sideband.";
}

function chatHistory(messages: Message[]): ChatTurn[] {
  return messages.filter(turn => turn.reply && !turn.reply.error)
    .slice(-maxHistory / 2).flatMap(({ prompt, reply }) => [
      { role: "user", content: prompt },
      // Reconsultar la API en lugar de dar al modelo resultados que pueden haber perdido permiso.
      { role: "assistant", content: previousAnswer(reply) },
    ]);
}

function traceIds(traces: ToolTrace[] = []) {
  let requestId: string | undefined;
  let meetingId: string | undefined;
  for (const { tool, data } of traces) {
    if (typeof data.request_id === "string") requestId = data.request_id;
    if (tool === "meeting_propose" && typeof data.id === "string") meetingId = data.id;
  }
  return { requestId, meetingId };
}

export function useDemoChat(person: Person, mode: DemoMode) {
  const connection = useDemoConnection(mode);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<Partial<Record<Conversation, Message[]>>>({});
  const [requests, setRequests] = useState<Partial<Record<Person, string>>>({});
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  const conversation = mode === "contacts" ? "ana-contacts" : person;
  const messages = history[conversation];

  async function send(prompt: string) {
    const id = ++sequence.current;
    const thread = messages ?? [];
    setPending(true);
    setDraft("");
    setHistory(current => ({ ...current, [conversation]: [...(current[conversation] ?? []), { id, prompt, reply: null }] }));
    let reply: ChatReply;
    try {
      const response = await fetch("/api/demo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person, mode, message: prompt, meetingId, requestId: requests[person], history: chatHistory(thread) }),
      });
      reply = ChatReply.parse(await response.json());
    } catch {
      connection.disconnect();
      reply = { error: "api", text: "No pude contactar el servidor local. Revisa la conexión e inténtalo de nuevo." };
    }

    if (reply.error) {
      if (reply.modelState) setDraft(current => current || prompt);
      connection.refresh();
    }
    const { requestId, meetingId: proposedMeeting } = traceIds(reply.traces);
    if (requestId !== undefined) setRequests(current => ({ ...current, [person]: requestId }));
    if (proposedMeeting !== undefined) setMeetingId(proposedMeeting);
    setHistory(current => ({ ...current, [conversation]: current[conversation]?.map(item => item.id === id ? { ...item, reply } : item) }));
    setPending(false);
  }

  return { connection, draft, setDraft, messages, meetingId, setMeetingId, pending, send };
}
