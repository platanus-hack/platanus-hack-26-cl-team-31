import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import {
  BROKER,
  flowVisibility,
  pointOnCurve,
  PULSE_MS,
  resolveId,
  SidebandMark,
  useFlowPlayback,
  useFlowViewport,
  type FlowActor,
} from "@team-31/agent-flow"
import { scenarioEvents } from "@team-31/agent-flow/scenario"
import {
  Activity,
  AudioLines,
  Bot,
  ChevronDown,
  CircleDot,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  UserRound,
  UsersRound,
  Waypoints,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/page"
import { useFlowLive } from "@/lib/flow-live"
import {
  agentBrand,
  describeSignal,
  personName,
  placeStation,
  signalTone,
} from "@/features/flow/presentation"

const replay = scenarioEvents()
const noop = () => {}
const list = (value: string | null) =>
  value
    ?.split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean) ?? []
const connectionLabels = {
  live: "En vivo",
  loading: "Conectando",
  reconnecting: "Reconectando",
  offline: "Sin conexión",
}

function Identity({ actor }: { actor: FlowActor }) {
  const { name, logo } = agentBrand(actor)
  return (
    <>
      <span className="signal-avatar" data-logo={logo}>
        {logo ? (
          <img src={`/agents/${logo}.svg`} alt="" />
        ) : actor.role === "owner" || actor.placeholder ? (
          <UserRound />
        ) : (
          <Bot />
        )}
      </span>
      <span className="signal-identity">
        <strong>{personName(actor.owner)}</strong>
        <small>{name}</small>
      </span>
    </>
  )
}

export function FlowPage() {
  const [params, setParams] = useSearchParams()
  const demo = params.get("modo") === "demo"
  const { events, status, error, truncated, reconnect } = useFlowLive(!demo)
  const viewport = useFlowViewport(false)
  const {
    rootRef,
    frameRef,
    layoutRef,
    stageRef,
    visibleRef,
    size,
    frame,
    full,
    cssFull,
    toggleFullscreen,
  } = viewport
  const { flow, clock, paused, setPaused, reset } = useFlowPlayback({
    flowEvents: demo ? replay : events,
    mode: demo ? "replay" : "live",
    loop: demo,
    autoPlay: true,
    initialSpeed: 1,
    controls: false,
    reducedMotion: false,
    visibleRef,
    selectEvent: noop,
  })
  const switchMode = () => {
    reset()
    setPaused(false)
    if (demo) reconnect()
    setParams(
      (p) => {
        if (demo) p.delete("modo")
        else p.set("modo", "demo")
        return p
      },
      { replace: true }
    )
  }
  const togglePause = useCallback(() => setPaused((p) => !p), [setPaused])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        e.repeat ||
        (e.target instanceof HTMLElement &&
          e.target.matches("input,textarea,[contenteditable=true]"))
      )
        return
      if (e.key === "f" || (e.key === "Escape" && cssFull)) {
        e.preventDefault()
        toggleFullscreen()
      }
      if (e.key === "p") {
        e.preventDefault()
        togglePause()
      }
    }
    window.addEventListener("keydown", keydown)
    return () => window.removeEventListener("keydown", keydown)
  }, [cssFull, toggleFullscreen, togglePause])

  const [filterOpen, setFilterOpen] = useState(false)
  const ownerParam = demo ? "reparto" : "titulares"
  const owners = params.get(ownerParam)
  const hidden = demo ? null : params.get("ocultos")
  const visibility = useMemo(() => {
    const query = list(owners)
    return flowVisibility(
      null,
      query.length ? query : null,
      new Set(hidden?.split(",").filter(Boolean))
    )
  }, [owners, hidden])
  const capacity = size.width < 580 ? 4 : 6
  const network = useMemo(() => {
    const present = [...flow.actors.values()].filter(
      (a) => a.presence !== "left"
    )
    const people = new Map(
      present.map(({ actor }) => [actor.owner.key, actor.owner])
    )
    const log = flow.log.filter(({ event }) =>
      visibility.eventVisibleIn(flow, event)
    )
    const recent = new Map<string, number>()
    for (const { event, t } of log) {
      if (event.step === "joined" || event.step === "left") continue
      for (const end of [event.from, event.to])
        if (end !== BROKER) recent.set(resolveId(flow, end.id), t)
    }
    const candidates = present.filter(({ actor }) =>
      visibility.actorVisibleIn(flow, actor.id)
    )
    // Quienes hablan tienen prioridad cuando la red no cabe en la pantalla.
    const stations = candidates
      .sort(
        (a, b) =>
          (recent.get(b.actor.id) ?? -1) - (recent.get(a.actor.id) ?? -1) ||
          Number(Boolean(a.actor.placeholder)) -
            Number(Boolean(b.actor.placeholder)) ||
          a.order - b.order
      )
      .slice(0, capacity)
      .sort((a, b) => a.order - b.order)
    return {
      people: [...people.values()],
      log,
      stations,
      total: candidates.length,
    }
  }, [flow, visibility, capacity])

  function setOwner(key: string) {
    const current = network.people
      .filter(visibility.ownerShown)
      .map((p) => p.key)
    const next =
      owners && current.includes(key)
        ? current.filter((k) => k !== key)
        : owners
          ? [...current, key]
          : [key]
    setParams(
      (p) => {
        if (next.length) p.set(ownerParam, next.join(","))
        else p.delete(ownerParam)
        return p
      },
      { replace: true }
    )
  }
  const height = frame.available || 450
  const stations = network.stations.map(({ actor }, index) => ({
    actor,
    ...placeStation(index, network.stations.length, size.width, height),
  }))
  // El registro interno de la solicitud no debe tapar una decisión de acceso.
  const latest = network.log.findLast(({ event }) => event.step !== "request")
  const track = latest?.event.requestId
    ? flow.requests.get(latest.event.requestId)
    : undefined
  const participant = (id?: string) => {
    const owner = id && flow.actors.get(resolveId(flow, id))?.actor.owner
    return owner ? personName(owner) : undefined
  }
  const sourceName = participant(track?.requester)
  const targetName = participant(track?.recipient)
  const fresh = latest && clock - latest.t < 1700
  const hubTone = fresh ? signalTone(latest.event) : undefined
  const pulses = network.log.filter(
    (entry) => clock - entry.t < PULSE_MS && entry.t <= clock
  )
  const caption = latest
    ? describeSignal(latest.event)
    : status === "offline" && !demo
      ? "Esperando conexión con Sideband"
      : "Esperando la próxima conversación"
  const source = demo ? "Demo guiada" : connectionLabels[status]

  return (
    <div
      ref={rootRef}
      className={`signal-page dark${cssFull ? "signal-expanded" : ""}`}
    >
      <div className="signal-frame" ref={frameRef}>
        <header className="signal-heading">
          <div>
            <span className="signal-kicker">
              <Waypoints size={15} /> Protocolo Sideband
            </span>
            <h1>
              Flujo de mensajes<span>.</span>
            </h1>
          </div>
          <div className="signal-controls">
            <Button variant="outline" onClick={switchMode}>
              {demo ? (
                <Radio data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {demo ? "Volver al vivo" : "Ver demo"}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={
                full ? "Salir de pantalla completa" : "Pantalla completa"
              }
              title="Pantalla completa (f)"
              onClick={toggleFullscreen}
            >
              {full ? <Minimize2 /> : <Maximize2 />}
            </Button>
          </div>
        </header>
        {!demo && error && status !== "live" ? (
          <ErrorState error={error} onRetry={reconnect} />
        ) : null}
        <section className="signal-console" aria-label="Mapa de conversaciones">
          <div className="signal-top">
            <div
              className="signal-source"
              data-connected={demo || status === "live"}
            >
              <i />
              {source}
            </div>
            <details
              className="signal-filter"
              onToggle={(e) => setFilterOpen(e.currentTarget.open)}
            >
              <summary>
                <UsersRound size={15} />
                {owners
                  ? "Personas filtradas"
                  : `${network.people.length} ${network.people.length === 1 ? "persona" : "personas"}`}
                <ChevronDown size={13} />
              </summary>
              <div className="signal-menu">
                <button
                  onClick={() =>
                    setParams(
                      (p) => {
                        p.delete(ownerParam)
                        if (!demo) p.delete("ocultos")
                        return p
                      },
                      { replace: true }
                    )
                  }
                >
                  Mostrar a todos
                </button>
                {filterOpen &&
                  network.people.map((p) => (
                    <label key={p.key}>
                      <input
                        type="checkbox"
                        checked={!!owners && visibility.ownerShown(p)}
                        onChange={() => setOwner(p.key)}
                      />
                      {personName(p)}
                    </label>
                  ))}
              </div>
            </details>
          </div>
          <div className="signal-space" ref={layoutRef}>
            <div className="signal-map" ref={stageRef}>
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${size.width} ${height}`}
                className="signal-routes"
                aria-hidden="true"
              >
                <g
                  className="signal-orbits"
                  transform={`translate(${size.width / 2} ${height / 2})`}
                >
                  {[65, 96, 135, 186, 250].map((r) => (
                    <circle key={r} r={r} />
                  ))}
                  <circle
                    className="signal-ticks"
                    r="78"
                    strokeDasharray="1 7"
                  />
                </g>
                {stations.map(({ actor, curve, d }) => {
                  const traffic = pulses.filter(
                    ({ event }) =>
                      [event.from, event.to].some(
                        (e) =>
                          e !== BROKER && resolveId(flow, e.id) === actor.id
                      ) && event.from !== event.to
                  )
                  const tone = traffic.length
                    ? signalTone(traffic.at(-1)!.event)
                    : undefined
                  return (
                    <g key={actor.id} data-tone={tone}>
                      <path className="signal-wire" d={d} />
                      <circle
                        className="signal-port"
                        cx={curve.start.x}
                        cy={curve.start.y}
                        r="3.5"
                      />
                      {traffic.map(({ event, t }) => {
                        const progress = Math.min(1, (clock - t) / PULSE_MS)
                        const p = pointOnCurve(
                          curve,
                          event.from === BROKER ? 1 - progress : progress
                        )
                        return (
                          <g
                            className="signal-packet"
                            data-tone={signalTone(event)}
                            key={event.id}
                            transform={`translate(${p.x} ${p.y})`}
                          >
                            <circle r="14" opacity=".12" />
                            <rect x="-8" y="-6" width="16" height="12" rx="3" />
                            <path d="m-6 -4 6 5 6-5" />
                          </g>
                        )
                      })}
                    </g>
                  )
                })}
              </svg>
              <div className="signal-hub" aria-label="Sideband">
                <div className="signal-core" data-tone={hubTone}>
                  <SidebandMark size={35} />
                  <b>Sideband</b>
                </div>
              </div>
              {stations.map(({ actor, x, y, cardWidth, cardHeight }) => (
                <div
                  className="signal-station"
                  data-tone={
                    fresh &&
                    [latest.event.from, latest.event.to].some(
                      (e) => e !== BROKER && resolveId(flow, e.id) === actor.id
                    )
                      ? hubTone
                      : undefined
                  }
                  key={actor.id}
                  style={{
                    left: x,
                    top: y,
                    width: cardWidth,
                    height: cardHeight,
                  }}
                  title={`${personName(actor.owner)} · ${agentBrand(actor).name}`}
                >
                  <Identity actor={actor} />
                </div>
              ))}
            </div>
          </div>
          <footer className="signal-footer">
            <span
              className="signal-audio"
              data-tone={latest && signalTone(latest.event)}
            >
              <AudioLines />
            </span>
            <div className="signal-caption">
              <small>
                {paused
                  ? "En pausa"
                  : latest
                    ? "Último movimiento"
                    : "Estado de la red"}
              </small>
              <strong role="status">{caption}</strong>
            </div>
            {sourceName && targetName ? (
              <span
                className="signal-pair"
                aria-label={`Conversación entre ${sourceName} y ${targetName}`}
              >
                {sourceName}
                <Waypoints size={15} />
                {targetName}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={paused ? "Reanudar" : "Pausar"}
              aria-pressed={paused}
              title="Pausar o reanudar (p)"
              onClick={togglePause}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
          </footer>
        </section>
        <div className="signal-legend" aria-label="Leyenda">
          <span data-tone="question">
            <CircleDot />
            Pregunta
          </span>
          <span data-tone="answer">
            <Activity />
            Respuesta
          </span>
          <span data-tone="decision">
            <ShieldCheck />
            Decisión de acceso
          </span>
          {network.total > capacity || (!demo && truncated) ? (
            <small>En pantalla · {stations.length} participantes</small>
          ) : null}
        </div>
      </div>
    </div>
  )
}
