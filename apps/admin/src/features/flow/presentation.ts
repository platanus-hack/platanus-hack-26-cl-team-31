import {
  BROKER,
  PULSE_MS,
  type EdgeCurve,
  type FlowActor,
  type FlowEvent,
  type FlowOwner,
  type FlowState,
} from "@team-31/agent-flow"

export function personName(owner: FlowOwner) {
  const id = owner.key.startsWith("user:") ? owner.key.slice(5) : undefined
  return id && (owner.label === id || owner.label === `${id.slice(0, 8)}…`)
    ? "Titular sin identificar"
    : owner.label
}

export function agentBrand(actor: FlowActor) {
  if (actor.role === "owner") return { name: "Titular" }
  if (actor.placeholder) return { name: "Sin agente conectado" }
  const source = (
    ["OpenClaw", "Grok Bot"].includes(actor.channel ?? "")
      ? actor.channel!
      : actor.label
  ).toLowerCase()
  const brands = [
    [/open\s?claw/, "OpenClaw", "openclaw"],
    [/\bgrok/, "Grok Bot", "grok"],
    [/\bclaude/, source.includes("code") ? "Claude Code" : "Claude", "claude"],
    [/\bcodex/, "Codex", "codex"],
    [/^dot(?:$|\s)/, "Dot", "openai"],
    [/\bchatgpt\b/, "ChatGPT", "openai"],
    [/\bopenai\b/, "OpenAI", "openai"],
  ] as const
  for (const [pattern, name, logo] of brands)
    if (pattern.test(source)) return { name, logo }
  return {
    name: /^(agente|mcp|webhook|polling|none)$/i.test(actor.label)
      ? "Agente personal"
      : actor.label,
  }
}

export function describeSignal(event: FlowEvent) {
  const who = (actor: FlowEvent["from"]) =>
    actor === BROKER ? "Sideband" : personName(actor.owner)
  const from = who(event.from),
    to = who(event.to)
  if (event.step === "delivered") {
    if (event.status === "denied") return `${to} recibe la denegación`
    if (event.status === "expired") return "Terminó el plazo para responder"
    if (event.status === "failed") return "El aviso no llegó a destino"
    if (event.meta.outcome === "no_data")
      return `${to} recibe una respuesta sin datos`
    return `La respuesta llega a ${to}`
  }
  switch (event.step) {
    case "ask":
      return event.status === "failed"
        ? `${from} no pudo enviar la pregunta`
        : `El agente de ${from} envía una pregunta`
    case "policy":
      return event.status === "denied"
        ? "Sideband deniega el acceso"
        : event.status === "allowed"
          ? "Sideband confirma el permiso"
          : "Hace falta el permiso del titular"
    case "request":
      return "Sideband registra la solicitud"
    case "wake":
      return event.status === "failed"
        ? `El aviso a ${to} no llegó`
        : `Sideband avisa al agente de ${to}`
    case "inbox":
      return `El agente de ${from} lee su bandeja`
    case "reply":
      return event.status === "failed" || event.status === "denied"
        ? `La respuesta de ${from} no se pudo entregar`
        : `El agente de ${from} responde`
    case "sanitized":
      return "Sideband conserva solo los datos permitidos"
    case "reply_blocked":
      return "Sideband detiene la respuesta"
    case "escalated":
      return `Sideband pide autorización a ${to}`
    case "owner_decided":
      return `${from} comunica su decisión`
    case "check":
      return `El agente de ${from} consulta si hay respuesta`
    case "tool":
      return `El agente de ${from} consulta a Sideband`
    case "joined":
      return `${from} se une a la red`
    case "left":
      return `${from} sale de la red`
  }
}

export function signalTone(event: FlowEvent) {
  if (
    ["blocked", "denied", "failed", "expired", "escalated"].includes(
      event.status
    )
  )
    return "decision"
  return ["reply", "delivered", "sanitized", "owner_decided"].includes(
    event.step
  )
    ? "answer"
    : "question"
}

// El pulso sigue el reloj del mapa para que la pausa también detenga la onda.
export function brokerPulse(log: FlowState["log"], clock: number) {
  const duration = 1500
  for (let i = log.length - 1; i >= 0; i--) {
    const { event, t, decision } = log[i]!
    if (clock - t >= duration + PULSE_MS) break
    if (!decision) continue
    const arrival =
      event.to === BROKER && event.from !== BROKER ? t + PULSE_MS : t
    const age = clock - arrival
    if (age >= 0 && age < duration)
      return { decision, progress: age / duration }
  }
}

export const brokerSize = { width: 192, height: 64 } as const

// Los puntos de salida están en el borde interior de las tarjetas. Todos los puntos
// de control quedan en el corredor central, incluso cuando cambia el ancho.
export function placeStation(
  index: number,
  count: number,
  width: number,
  height: number
) {
  const mobile = width < 580
  const side = index % 2
  const rank = Math.floor(index / 2)
  const total = Math.ceil((count - side) / 2)
  const fraction = (rank + 0.5) / total
  const pad = mobile ? 10 : Math.min(48, width * 0.035)
  const cardWidth = mobile
    ? Math.min(180, (width - pad * 3) / 2)
    : Math.min(230, width * 0.245)
  const cardHeight = mobile ? 70 : 78
  const x = mobile
    ? width * fraction
    : side
      ? width - pad - cardWidth / 2
      : pad + cardWidth / 2
  const y = mobile
    ? side
      ? height - pad - cardHeight / 2
      : pad + cardHeight / 2
    : height * fraction
  const sign = side ? -1 : 1
  const start = mobile
    ? { x, y: y + (sign * cardHeight) / 2 }
    : { x: x + (sign * cardWidth) / 2, y }
  const end = mobile
    ? {
        x: width / 2 + (fraction - 0.5) * 65,
        y: height / 2 - (sign * brokerSize.height) / 2,
      }
    : {
        x: width / 2 - (sign * brokerSize.width) / 2,
        y: height / 2 + (fraction - 0.5) * 44,
      }
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const curve: EdgeCurve = mobile
    ? { start, c1: { x, y: middle.y }, c2: { x: end.x, y: middle.y }, end }
    : { start, c1: { x: middle.x, y }, c2: { x: middle.x, y: end.y }, end }
  const d = `M${start.x} ${start.y} C${curve.c1.x} ${curve.c1.y} ${curve.c2.x} ${curve.c2.y} ${end.x} ${end.y}`
  return { x, y, cardWidth, cardHeight, curve, d }
}
