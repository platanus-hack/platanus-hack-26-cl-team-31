"use client";
// Visualizador del flujo entre agentes. Escenario híbrido escrito a mano, sin librerías de grafos ni
// de animación: aristas y pulsos en SVG, tarjetas de titulares y el broker en HTML (tipografía real,
// foco y teclado). Las animaciones usan requestAnimationFrame sobre un reloj de reproducción propio,
// así que pausar congela todo y la velocidad lo escala.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { ChannelIcon, SidebandMark } from "./icons.js";
import { categoryLabel, describeEvent, endpointLabel, outcomeLabel, rowStepLabels, ruleLabel, statusLabels, stepDetail, stepLabels, toolLabel } from "./labels.js";
import { edgeCurve, layoutFlow, pointOnCurve, stageHeightFor, type LayoutInput } from "./layout.js";
import { BROKER, type FlowActor, type FlowEvent, type FlowStatus } from "./model.js";
import { EDGE_MS, LABEL_MS, PULSE_MS } from "./schedule.js";
import { activities, eventEndpoints, resolveId, type ActorEntry, type Activity, type AppliedEvent, type FlowState } from "./state.js";
import { flowVisibility } from "./flow-visibility.js";
import { useFlowViewport } from "./use-flow-viewport.js";
import { useFlowPlayback } from "./use-flow-playback.js";
import { css, statusColor, statusTone } from "./styles.js";

type Playback = { mode: "replay"; loop?: boolean } | { mode: "live"; loop?: never };

export type AgentFlowProps = Playback & {
  events: readonly FlowEvent[];
  /** Nombre accesible del grafo. */
  title?: string;
  /** Contenido extra en la barra (p. ej. el estado de la conexión en vivo). */
  toolbar?: ReactNode;
  /** Titulares visibles al inicio: dirección, nombre o la parte antes de @ (sin distinguir mayúsculas). */
  defaultOwners?: readonly string[];
  emptyText?: string;
  /** Muestra la barra de controles (pausa, velocidad, filtro, pantalla completa). */
  controls?: boolean;
  autoPlay?: boolean;
  /** Velocidad inicial (0.25–4). */
  speed?: number;
  /** Muestra el detalle y la línea de tiempo al costado. */
  panels?: boolean;
  /** Ocupa todo el alto del contenedor y escala para proyectar (modo embed). */
  fill?: boolean;
  /** Ofrece pantalla completa (botón y tecla f). */
  allowFullscreen?: boolean;
  /** Muestra la red completa: entradas, salidas y participantes pasivos. Sin ella solo aparecen quienes conversan. */
  presence?: boolean;
  /** Agentes ocultos al inicio (ids de actor, p. ej. `agent:<id>`). */
  defaultHiddenActors?: readonly string[];
  /** Avisa cada cambio del filtro: titulares visibles (claves; null = todos) y agentes ocultos. Sirve para guardarlo en la URL. */
  onFilterChange?: (filter: { owners: string[] | null; hiddenActors: string[] }) => void;
  /** Acciones extra en el detalle de un paso (p. ej. enlaces a la solicitud o la traza en el admin). */
  eventActions?: (event: FlowEvent) => ReactNode;
  className?: string;
  style?: CSSProperties;
};

type Selection = { kind: "actor"; id: string } | { kind: "event"; id: string } | { kind: "hub" } | null;

const SPEEDS = [0.5, 1, 2, 4] as const;
// Presencia (ms del reloj de reproducción).
const JOIN_MS = 1_100; // entrada con rebote
const CHIP_MS = 3_800; // chip «Nuevo»
const LEAVE_ANIM_MS = 850; // se apaga, se encoge y se aleja
const LEAVE_MS = 2_400; // queda un contorno fantasma y luego deja la red
const DRAW_MS = 650; // la arista se dibuja hacia el broker al conversar por primera vez
const GLOW_MS = 1_400; // brillo al pasar de pasivo a activo
const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

type Motion = { joinT?: number; leftT?: number; leaveP?: number };
type Box = { x: number; y: number; w: number; h: number; round: boolean };
type Chip = { label: string; opacity: number; style: CSSProperties };
const TIMELINE_LIMIT = 80;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

const clockFormat = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : undefined;

const activityLabels: Record<Activity, string> = {
  idle: "en espera",
  waiting: "esperando respuesta",
  thinking: "pensando una respuesta",
  deciding: "decidiendo",
};

export function AgentFlow({
  events,
  mode,
  loop = mode === "replay",
  title = "Flujo entre agentes",
  toolbar,
  defaultOwners,
  emptyText,
  className,
  style,
  controls = true,
  autoPlay = true,
  speed: initialSpeed = 1,
  panels = true,
  fill = false,
  allowFullscreen = true,
  presence = true,
  defaultHiddenActors,
  onFilterChange,
  eventActions,
}: AgentFlowProps) {
  const flowEvents = useMemo(() => (presence ? events : events.filter((e) => e.step !== "joined" && e.step !== "left")), [events, presence]);
  const reducedMotion = usePrefersReducedMotion();
  const { rootRef, stageRef, layoutRef, frameRef, visibleRef, full, fillMode, cssFull, toggleFullscreen, frame, size, scale } = useFlowViewport(fill);
  const [showPanels, setShowPanels] = useState(panels);
  const [ownerQuery, setOwnerQuery] = useState<string[] | null>(() => (defaultOwners?.length ? defaultOwners.map((o) => o.toLowerCase()) : null));
  const [selection, setSelection] = useState<Selection>(null);
  const [shownOwners, setShownOwners] = useState<Set<string> | null>(null);
  const [hiddenActors, setHiddenActors] = useState<Set<string>>(() => new Set(defaultHiddenActors ?? []));
  const selectEvent = useCallback((id: string | null) => setSelection(id === null ? null : { kind: "event", id }), []);
  const {
    flow, clock, paused, setPaused, speed, setSpeed, history, seeking, announcement, inspect, pending,
    reset, inspectEvent, inspectMany, inspectRequest, exitInspect, stepInspect,
  } = useFlowPlayback({ flowEvents, mode, loop, autoPlay, initialSpeed, controls, reducedMotion, visibleRef, selectEvent });

  // Atajos: f pantalla completa, p pausa, ←/→ pasos, Esc vuelve al presente o sale del modo expandido.
  // En embed y pantalla completa escuchan en todo el documento; si no, solo con el foco dentro.
  const onShortcut = (event: KeyboardEvent | ReactKeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.key === "f" && allowFullscreen) {
      event.preventDefault();
      toggleFullscreen();
    } else if (event.key === "p" && controls) {
      event.preventDefault();
      if (inspect) exitInspect();
      else setPaused((value) => !value);
    } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && controls) {
      event.preventDefault();
      stepInspect(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "Escape") {
      if (inspect) exitInspect();
      else if (cssFull) toggleFullscreen();
    }
  };
  const shortcutRef = useRef(onShortcut);
  useEffect(() => {
    shortcutRef.current = onShortcut;
  });
  useEffect(() => {
    if (!fillMode) return;
    const listener = (event: KeyboardEvent) => shortcutRef.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [fillMode]);
  // Paneles al costado solo si al grafo le quedan al menos ~760 px.
  const wide = size.root >= 1100;
  // En embed angosto no hay espacio para los paneles: el grafo ocupa todo.
  const sidePanels = showPanels && (!fillMode || wide);

  // ---------- Filtro ----------
  const ownerList = useMemo(() => [...flow.owners.values()].sort((a, b) => a.order - b.order).map((o) => o.owner), [flow.owners]);
  const actorList = useMemo(() => [...flow.actors.values()].sort((a, b) => a.order - b.order), [flow.actors]);
  const { ownerShown, actorVisibleIn, eventVisibleIn } = flowVisibility(shownOwners, ownerQuery, hiddenActors);
  const actorVisible = (id: string) => actorVisibleIn(flow, id);

  // ---------- Layout ----------
  const visibleOwners = ownerList.filter((owner) => actorList.some((e) => e.actor.owner.key === owner.key && actorVisible(e.actor.id) && !(e.presence === "left" && clock - (e.leftT ?? 0) > LEAVE_MS)));
  // Quien salió se desvanece durante LEAVE_MS y luego deja la red (y su casilla).
  const gone = (e: ActorEntry) => e.presence === "left" && clock - (e.leftT ?? 0) > LEAVE_MS;
  const visibleActors = actorList.filter((e) => actorVisible(e.actor.id) && !gone(e));
  // Al inspeccionar, las casillas salen de la historia completa: nada se reacomoda durante la repetición.
  const layoutOwners = history
    ? [...history.owners.values()].sort((a, b) => a.order - b.order).map((o) => o.owner).filter((o) => visibleOwners.some((v) => v.key === o.key) || [...history.actors.values()].some((e) => e.actor.owner.key === o.key && actorVisibleIn(history, e.actor.id) && e.presence !== "left"))
    : visibleOwners;
  const layoutActors = history
    ? [...history.actors.values()].sort((a, b) => a.order - b.order).filter((e) => layoutOwners.some((o) => o.key === e.actor.owner.key) && (visibleActors.some((v) => v.actor.id === e.actor.id) || (actorVisibleIn(history, e.actor.id) && e.presence !== "left")))
    : visibleActors;
  const extraActors = history ? visibleActors.filter((v) => !layoutActors.some((e) => e.actor.id === v.actor.id)) : [];
  const layoutKey = JSON.stringify([
    [...layoutOwners, ...visibleOwners.filter((o) => !layoutOwners.some((l) => l.key === o.key))].map((o) => ({ key: o.key })),
    [...layoutActors, ...extraActors].map((e) => ({ id: e.actor.id, ownerKey: e.actor.owner.key, role: e.actor.role })),
  ]);
  const { layout, stageHeight } = useMemo(() => {
    const [owners, actors] = JSON.parse(layoutKey) as [LayoutInput["owners"], LayoutInput["actors"]];
    const required = stageHeightFor(size.width, owners, actors);
    // Embed y pantalla completa: el escenario llena el alto disponible.
    const height = fillMode && frame.available > 0 ? Math.max(Math.round(frame.available), Math.min(required, 360)) : required;
    return { layout: layoutFlow({ width: size.width, height, owners, actors }), stageHeight: height };
  }, [layoutKey, size.width, fillMode, frame.available]);

  const visibleLog = flow.log.filter((entry) => eventVisibleIn(flow, entry.event));
  // Al inspeccionar, la línea de tiempo y el detalle siguen mostrando toda la historia.
  const record = history ?? flow;
  const recordLog = history ? history.log.filter((entry) => eventVisibleIn(history, entry.event)) : visibleLog;
  const acts = useMemo(() => activities(flow), [flow]);

  // Lo reciente: pulsos en tránsito, aristas encendidas y el último paso de cada actor y del broker.
  const recent = visibleLog.filter((entry) => clock >= entry.t && clock - entry.t < LABEL_MS);
  const hotEdges = new Map<string, AppliedEvent>();
  const lastStep = new Map<string, AppliedEvent>();
  const flash = new Map<string, FlowStatus>();
  let hubStep: AppliedEvent | undefined;
  for (const entry of recent) {
    const { fromId, toId } = eventEndpoints(flow, entry.event);
    const age = clock - entry.t;
    if (fromId === toId && fromId !== BROKER) continue; // entrada o salida de la red
    if (fromId === toId) {
      hubStep = entry;
      if (age < EDGE_MS) flash.set(BROKER, entry.event.status);
      continue;
    }
    const actorId = fromId === BROKER ? toId : fromId;
    if (age < EDGE_MS) hotEdges.set(actorId, entry);
    lastStep.set(actorId, entry);
    // El color llega al destino cuando termina el pulso.
    if (age < EDGE_MS) flash.set(age > PULSE_MS * 0.85 ? toId : fromId, entry.event.status);
  }

  // ---------- Selección ----------
  const select = (next: Selection) => setSelection((current) => (JSON.stringify(current) === JSON.stringify(next) ? null : next));
  const findEvent = (id: string) => record.log.find((entry) => entry.event.id === id);
  const timeLabel = (entry: AppliedEvent) =>
    mode === "live" && clockFormat ? clockFormat.format(new Date(entry.event.at)) : `+${(entry.t / 1000).toFixed(1)} s`;

  const toggleOwner = (key: string) => {
    const next = new Set(shownOwners ?? ownerList.filter(ownerShown).map((o) => o.key));
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setShownOwners(ownerList.every((o) => next.has(o.key)) ? null : next);
    setOwnerQuery(null);
  };
  const toggleActor = (id: string) =>
    setHiddenActors((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const filtered = Boolean(shownOwners) || Boolean(ownerQuery) || hiddenActors.size > 0;
  const filterChangeRef = useRef(onFilterChange);
  useEffect(() => {
    filterChangeRef.current = onFilterChange;
  });
  const filter = useMemo(() => ({
    owners: shownOwners ? [...shownOwners] : ownerQuery,
    hiddenActors: [...hiddenActors],
  }), [shownOwners, ownerQuery, hiddenActors]);
  const reportedFilter = useRef(JSON.stringify(filter));
  useEffect(() => {
    const key = JSON.stringify(filter);
    if (reportedFilter.current === key) return;
    reportedFilter.current = key;
    filterChangeRef.current?.(filter);
  }, [filter]);

  const selectedEvent = selection?.kind === "event" ? findEvent(selection.id) : undefined;
  const selectedActor = selection?.kind === "actor" ? flow.actors.get(selection.id) : undefined;
  const timelineExpansion = useTimelineExpansion(inspectMany);
  const modeState = paused ? "paused" : mode === "live" ? "live" : "playing";
  const modeText = paused ? "En pausa" : mode === "live" ? "En vivo" : `Repetición · ${speed}×`;
  const fade = (entry: AppliedEvent) => Math.max(0, Math.min(1, (LABEL_MS - (clock - entry.t)) / 400));

  // Elegir un paso: abre su detalle y, con controles, repite su animación en el grafo.
  const pick = (id: string) => {
    setSelection({ kind: "event", id });
    inspectEvent(id);
  };
  const focusActors = inspect ? new Set(inspect.focus.actors.map((id) => resolveId(flow, id))) : null;
  const dimmed = (ids: string[]) => Boolean(focusActors) && !ids.some((id) => focusActors!.has(id));
  const inspectBar = (() => {
    if (!inspect) return null;
    const entry = inspect.first;
    const steps = inspect.focus.ids.length;
    const what = steps > 1 ? `${steps} pasos` : `${stepLabels[entry.event.step]}${stepDetail(entry.event) ? ` · ${stepDetail(entry.event)}` : ""}`;
    return (
      <span className="af-inspect" role="status">
        <span className="af-dot" />
        <span className="af-inspect-text">
          Viendo <b className="af-mono">{timeLabel(entry)}</b> · {route(entry.event)} · {what}
        </span>
        {mode === "live" && pending > 0 ? <span className="af-count">{pending} nuevos</span> : null}
        <button type="button" className="af-inspect-back" onClick={exitInspect}>
          {mode === "live" ? "Volver al vivo" : "Continuar"}
        </button>
      </span>
    );
  })();

  // ---------- Presencia ----------
  // Primer paso de cada actor (no cuenta entrar a la red): hasta entonces es un participante pasivo.
  const firstStep = new Map<string, number>();
  for (const entry of visibleLog) {
    if (entry.event.step === "joined" || entry.event.step === "left") continue;
    const { fromId, toId } = eventEndpoints(flow, entry.event);
    for (const id of [fromId, toId]) if (id !== BROKER && !firstStep.has(id)) firstStep.set(id, entry.t);
  }
  const ownerRows = (key: string) => visibleActors.filter((e) => e.actor.owner.key === key);
  const motionOf = (key: string): Motion => {
    const rows = ownerRows(key);
    const joins = rows.map((e) => e.joinedT);
    const joinT = joins.length > 0 && joins.every((t) => t !== undefined) ? Math.max(...(joins as number[])) : undefined;
    const allLeft = rows.length > 0 && rows.every((e) => e.presence === "left");
    const leftT = allLeft ? Math.max(...rows.map((e) => e.leftT ?? 0)) : undefined;
    return {
      ...(joinT !== undefined && clock - joinT < CHIP_MS && clock >= joinT ? { joinT } : {}),
      ...(leftT !== undefined ? { leftT, leaveP: (clock - leftT) / LEAVE_ANIM_MS } : {}),
    };
  };
  const ownerBox = (key: string): Box | undefined => {
    if (layout.density === "dots") {
      const node = layout.nodes.get(key);
      const r = layout.nodeRadius;
      return node ? { x: node.x - r, y: node.y - r, w: r * 2, h: r * 2, round: true } : undefined;
    }
    const card = layout.cards.get(key);
    return card ? { ...card, round: false } : undefined;
  };
  const ownerHot = (key: string) => ownerRows(key).map((e) => hotEdges.get(e.actor.id)).find(Boolean);
  const edgeActors = layout.density === "dots" ? visibleOwners.map((o) => ownerRows(o.key)[0]).filter((e): e is ActorEntry => Boolean(e)) : visibleActors;
  const motionStyle = (key: string, motion: Motion, glow: number): CSSProperties => {
    const box = ownerBox(key);
    if (!box) return {};
    const cx = box.x + box.w / 2 - layout.hub.x;
    const cy = box.y + box.h / 2 - layout.hub.y;
    const length = Math.hypot(cx, cy) || 1;
    const [dx, dy] = [cx / length, cy / length];
    const style: CSSProperties = {};
    if (glow > 0 && layout.density === "cards") {
      style.boxShadow = `var(--af-surface-shadow), 0 0 0 1px rgb(125 180 255 / ${(0.55 * glow).toFixed(3)}), 0 0 32px rgb(0 113 252 / ${(0.32 * glow).toFixed(3)})`;
    }
    if (motion.leftT !== undefined) {
      const q = Math.min(1, motion.leaveP ?? 1);
      if (reducedMotion) return { ...style, opacity: 0.45 };
      const e = ease(q);
      return { ...style, opacity: q < 1 ? 1 - 0.85 * q : 0, scale: String(1 - 0.2 * e), translate: `${(dx * 18 * e).toFixed(1)}px ${(dy * 18 * e).toFixed(1)}px`, filter: `grayscale(${q.toFixed(2)})` };
    }
    if (motion.joinT !== undefined && !reducedMotion) {
      const p = (clock - motion.joinT) / JOIN_MS;
      if (p < 1) {
        // Entra desde fuera de su casilla con un leve rebote: 0.6 → 1.04 → 1.
        const scale = p < 0.7 ? 0.6 + 0.44 * ease(p / 0.7) : 1.04 - 0.04 * ease((p - 0.7) / 0.3);
        const offset = 28 * (1 - ease(p));
        return { ...style, opacity: Math.min(1, p / 0.35), scale: scale.toFixed(3), translate: `${(dx * offset).toFixed(1)}px ${(dy * offset).toFixed(1)}px` };
      }
    }
    return style;
  };
  const ownerChip = (motion: Motion): Chip | undefined => {
    if (motion.leftT !== undefined) return { label: "Salió", opacity: 1, style: { color: "var(--af-muted)", background: "var(--af-chip-active)" } };
    if (motion.joinT === undefined) return undefined;
    const age = clock - motion.joinT;
    return { label: "Nuevo", opacity: Math.max(0, Math.min(1, (CHIP_MS - age) / 600)), style: { color: "var(--af-accent-ink)", background: "var(--af-accent-soft)" } };
  };
  const presentOwners = visibleOwners.filter((o) => !ownerRows(o.key).every((e) => e.presence === "left"));
  const network = {
    present: presentOwners.length,
    active: presentOwners.filter((o) => ownerRows(o.key).some((e) => (acts.get(e.actor.id) ?? "idle") !== "idle" || lastStep.has(e.actor.id))).length,
    bump: visibleLog.some((e) => (e.event.step === "joined" || e.event.step === "left") && clock >= e.t && clock - e.t < 1_200),
  };

  const rowTag = (entry: ActorEntry, motion: Motion) => {
    const { actor } = entry;
    const step = lastStep.get(actor.id);
    const activity = acts.get(actor.id);
    if (entry.presence === "left") return motion.leftT === undefined ? <span className="af-tag" style={{ color: "var(--af-muted)", background: "var(--af-chip-active)" }}>Salió</span> : null;
    // Un agente nuevo en una tarjeta que ya estaba.
    const fresh = motion.joinT === undefined && entry.joinedT !== undefined && clock >= entry.joinedT && clock - entry.joinedT < CHIP_MS;
    // En pantallas angostas basta un punto de color: el texto completo está en aria-label y en el detalle.
    if (layout.compact) {
      const color = step ? statusColor[step.event.status] : fresh ? "var(--af-accent-ink)" : activity === "thinking" ? "var(--af-info)" : activity === "deciding" ? "var(--af-warn)" : activity === "waiting" ? "var(--af-body)" : undefined;
      return color ? <span className="af-dot af-row-dot" style={{ color }} /> : null;
    }
    if (step) return <Tag status={step.event.status} label={rowStepLabels[step.event.step]} />;
    if (activity === "thinking")
      return (
        <span className="af-tag" style={{ color: "var(--af-info)", background: "var(--af-info-bg)" }}>
          Pensando <span className="af-thinking" aria-hidden="true"><i /><i /><i /></span>
        </span>
      );
    if (activity === "waiting") return <span className="af-tag" style={{ color: "var(--af-body)", background: "var(--af-chip)" }}>Esperando</span>;
    if (activity === "deciding") return <span className="af-tag" style={{ color: "var(--af-warn)", background: "var(--af-warn-bg)" }}>Decide</span>;
    if (fresh) return <span className="af-tag" style={{ color: "var(--af-accent-ink)", background: "var(--af-accent-soft)" }}>Nuevo</span>;
    return null;
  };

  return (
    <div
      ref={rootRef}
      className={["af-root", fillMode ? "af-fill" : "", inspect ? "af-inspecting" : "", seeking ? "af-seeking" : "", cssFull ? "af-expanded" : "", paused ? "af-paused" : "", reducedMotion ? "af-reduced" : "", className ?? ""].filter(Boolean).join(" ")}
      style={{ ...style, "--af-stage-h": `${stageHeight}px` } as CSSProperties}
      onKeyDown={fillMode ? undefined : onShortcut}
    >
      <style>{css}</style>
      <div
        ref={frameRef}
        className={["af-frame", wide && sidePanels ? "af-wide" : "", controls ? "af-has-bar" : ""].filter(Boolean).join(" ")}
        style={scale !== 1 ? { width: frame.width / scale, height: frame.height / scale, transform: `scale(${scale})` } : undefined}
      >
      {controls ? (
      <div className="af-bar" role="toolbar" aria-label="Controles de reproducción">
        <button type="button" className="af-btn" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? <PlayIcon /> : <PauseIcon />} {paused ? "Reanudar" : "Pausar"}
        </button>
        {mode === "replay" ? (
          <button type="button" className="af-btn" onClick={() => { reset(); setPaused(false); }}>
            <ReplayIcon /> Repetir
          </button>
        ) : null}
        <div className="af-seg" role="group" aria-label="Velocidad">
          {SPEEDS.map((value) => (
            <button key={value} type="button" aria-pressed={speed === value} aria-label={`Velocidad ${value}×`} onClick={() => setSpeed(value)}>
              {value}×
            </button>
          ))}
        </div>
        <details className="af-filter">
          <summary className="af-btn">
            <FilterIcon /> Agentes <span className="af-count">{filtered ? `${agentCount(visibleActors)}/${agentCount(actorList)}` : agentCount(actorList)}</span>
          </summary>
          <div className="af-menu">
            <fieldset>
              <legend className="af-eyebrow">Mostrar solo</legend>
              {ownerList.length === 0 ? <p className="af-placeholder" style={{ padding: "4px 8px" }}>Los titulares aparecen con su primer paso.</p> : null}
              {ownerList.map((owner) => {
                const isShown = ownerShown(owner);
                return (
                  <div key={owner.key}>
                    <label className="af-check">
                      <input type="checkbox" checked={isShown} onChange={() => toggleOwner(owner.key)} />
                      <span>{owner.label}</span>
                    </label>
                    {actorList
                      .filter((e) => e.actor.owner.key === owner.key && e.actor.role === "agent" && !e.actor.placeholder)
                      .map((e) => (
                        <label key={e.actor.id} className="af-check af-sub">
                          <input type="checkbox" disabled={!isShown} checked={isShown && !hiddenActors.has(e.actor.id)} onChange={() => toggleActor(e.actor.id)} />
                          <span>{e.actor.label}</span>
                        </label>
                      ))}
                  </div>
                );
              })}
            </fieldset>
            {filtered ? (
              <div className="af-menu-actions">
                <button type="button" onClick={() => { setShownOwners(null); setOwnerQuery(null); setHiddenActors(new Set()); }}>Mostrar todos</button>
              </div>
            ) : null}
          </div>
        </details>
        {inspectBar}
        <span className="af-bar-spacer" />
        {presence && layout.compact ? <NetworkCounter present={network.present} active={network.active} bump={network.bump} inline /> : null}
        {toolbar}
        {wide ? (
          <button type="button" className="af-btn af-btn-icon" aria-pressed={showPanels} aria-label={showPanels ? "Ocultar detalle y línea de tiempo" : "Mostrar detalle y línea de tiempo"} title="Detalle y línea de tiempo" onClick={() => setShowPanels((v) => !v)}>
            <PanelIcon />
          </button>
        ) : null}
        {allowFullscreen ? (
          <button type="button" className="af-btn af-btn-icon" aria-pressed={full} aria-label={full ? "Salir de pantalla completa (f)" : "Pantalla completa (f)"} title={full ? "Salir de pantalla completa (f)" : "Pantalla completa (f)"} onClick={toggleFullscreen}>
            {full ? <ShrinkIcon /> : <ExpandIcon />}
          </button>
        ) : null}
      </div>
      ) : null}

      <div className="af-layout" ref={layoutRef}>
        <div
          ref={stageRef}
          className="af-stage"
          style={{ height: stageHeight }}
          role="group"
          aria-label={`${title}. ${visibleOwners.length} titulares y ${visibleActors.length} agentes alrededor del broker de Sideband. La línea de tiempo describe cada paso.`}
        >
          {!layout.compact ? (
            <span className="af-mode" data-state={modeState}>
              <span className="af-dot" />
              {modeText}
            </span>
          ) : null}
          {presence && !layout.compact ? <NetworkCounter present={network.present} active={network.active} bump={network.bump} /> : null}
          <svg className="af-svg" viewBox={`0 0 ${size.width} ${stageHeight}`} aria-hidden="true">
            {edgeActors.map(({ actor }) => {
              const slot = layout.slots.get(actor.id);
              if (!slot) return null;
              const first = firstStep.get(actor.id);
              const motion = motionOf(actor.owner.key);
              // Pasivo: sin arista. Al conversar por primera vez, la arista se dibuja hacia el broker.
              if (first === undefined || clock < first) return null;
              const curve = edgeCurve(slot, layout);
              const hot = layout.density === "dots" ? ownerHot(actor.owner.key) : hotEdges.get(actor.id);
              const draw = reducedMotion ? 1 : ease(Math.min(1, (clock - first) / DRAW_MS));
              const retract = motion.leaveP === undefined || reducedMotion ? 0 : ease(Math.min(1, motion.leaveP));
              const actorLeft = flow.actors.get(actor.id)?.presence === "left";
              return (
                <path
                  key={`edge-${actor.id}`}
                  className="af-edge"
                  d={`M${curve.start.x} ${curve.start.y}C${curve.c1.x} ${curve.c1.y} ${curve.c2.x} ${curve.c2.y} ${curve.end.x} ${curve.end.y}`}
                  pathLength={1}
                  strokeDasharray="1 1"
                  strokeDashoffset={actorLeft ? -retract : 1 - draw}
                  data-human={actor.role === "owner" ? "" : undefined}
                  data-hot={hot ? "" : undefined}
                  data-dim={dimmed(layout.density === "dots" ? ownerRows(actor.owner.key).map((e) => e.actor.id) : [actor.id]) ? "" : undefined}
                  style={hot ? { stroke: statusColor[hot.event.status] } : undefined}
                />
              );
            })}
            {visibleOwners.map((owner) => {
              const motion = motionOf(owner.key);
              const box = ownerBox(owner.key);
              if (!box) return null;
              const parts: ReactNode[] = [];
              if (motion.joinT !== undefined) {
                const age = clock - motion.joinT;
                if (reducedMotion) {
                  if (age < CHIP_MS) parts.push(<Outline key="static" box={box} inflate={4} opacity={0.9} dashed={false} />);
                } else {
                  // Dos ondas del color de acento y una línea de descubrimiento hacia el broker.
                  for (const delay of [JOIN_MS * 0.55, JOIN_MS * 0.55 + 380]) {
                    const p = (age - delay) / 900;
                    if (p > 0 && p < 1) parts.push(<Outline key={`ripple-${delay}`} box={box} inflate={3 + 22 * ease(p)} opacity={(1 - p) * 0.75} dashed={false} />);
                  }
                  const d = (age - 350) / 1300;
                  const slot = layout.slots.get(visibleActors.find((e) => e.actor.owner.key === owner.key)?.actor.id ?? "");
                  if (d > 0 && d < 1 && slot) {
                    const c = edgeCurve(slot, layout);
                    parts.push(
                      <path
                        key="discovery"
                        className="af-discovery"
                        d={`M${c.start.x} ${c.start.y}C${c.c1.x} ${c.c1.y} ${c.c2.x} ${c.c2.y} ${c.end.x} ${c.end.y}`}
                        strokeDashoffset={-age * 0.05}
                        opacity={Math.sin(Math.PI * d) * 0.9}
                      />,
                    );
                  }
                }
              }
              if (motion.leaveP !== undefined && motion.leaveP >= 1 && !reducedMotion) {
                const g = (clock - (motion.leftT ?? 0) - LEAVE_ANIM_MS) / (LEAVE_MS - LEAVE_ANIM_MS);
                if (g < 1) parts.push(<Outline key="ghost" box={box} inflate={0} opacity={(1 - g) * 0.5} dashed />);
              }
              return parts.length ? <g key={`fx-${owner.key}`}>{parts}</g> : null;
            })}
            {!reducedMotion &&
              recent.map((entry) => {
                const progress = (clock - entry.t) / PULSE_MS;
                if (progress < 0 || progress > 1) return null;
                const { fromId, toId } = eventEndpoints(flow, entry.event);
                if (fromId === toId) return null;
                const actorId = fromId === BROKER ? toId : fromId;
                const slot = layout.slots.get(actorId);
                if (!slot) return null;
                const eased = 1 - Math.pow(1 - progress, 3);
                const p = pointOnCurve(edgeCurve(slot, layout), fromId === BROKER ? 1 - eased : eased);
                const color = statusColor[entry.event.status];
                return (
                  <g key={`pulse-${entry.event.id}`}>
                    <circle cx={p.x} cy={p.y} r={9} fill={color} opacity={0.16} />
                    <circle cx={p.x} cy={p.y} r={3.5} fill={color} />
                  </g>
                );
              })}
            {hubStep && !reducedMotion ? (
              <rect
                className="af-burst"
                x={layout.hub.x - layout.hub.size / 2 - 7 - 10 * Math.min(1, (clock - hubStep.t) / 700)}
                y={layout.hub.y - layout.hub.size / 2 - 7 - 10 * Math.min(1, (clock - hubStep.t) / 700)}
                width={layout.hub.size + 14 + 20 * Math.min(1, (clock - hubStep.t) / 700)}
                height={layout.hub.size + 14 + 20 * Math.min(1, (clock - hubStep.t) / 700)}
                rx={(layout.hub.size + 14) * 0.34}
                stroke={statusColor[hubStep.event.status]}
                opacity={Math.max(0, 1 - (clock - hubStep.t) / 900) * 0.8}
              />
            ) : null}
          </svg>

          <div
            className="af-hub"
            style={{
              width: layout.hubZone.w,
              transform: `translate(${layout.hubZone.x}px, ${layout.hub.y - layout.hub.size / 2}px)`,
              ["--af-hub-w" as string]: `${layout.hubZone.w}px`,
            }}
          >
            <button
              type="button"
              className="af-seal"
              aria-pressed={selection?.kind === "hub"}
              aria-label="Broker de Sideband: evalúa permisos, firma, avisa y sanea respuestas"
              data-flash={flash.has(BROKER) ? "" : undefined}
              style={{ width: layout.hub.size, height: layout.hub.size, ["--af-flash" as string]: flash.get(BROKER) ? statusColor[flash.get(BROKER)!] : undefined }}
              onClick={() => select({ kind: "hub" })}
            >
              <SidebandMark size={Math.round(layout.hub.size * 0.42)} />
            </button>
            <span className="af-hub-label">
            <span className="af-hub-name">
              <b>Sideband</b>
              <span className="af-eyebrow">Broker</span>
            </span>
            <span className="af-hub-slot" aria-hidden="true">
              {hubStep ? (
                <span style={{ opacity: fade(hubStep) }}>
                  <Tag status={hubStep.event.status} label={hubText(hubStep.event)} />
                </span>
              ) : (
                <span className="af-hub-hint">
                  {visibleLog.length === 0 ? (emptyText ?? (mode === "live" ? "Esperando eventos del broker…" : "Preparando la conversación…")) : paused ? "En pausa" : "Sin pasos en curso"}
                </span>
              )}
            </span>
            </span>
          </div>

          {visibleOwners.map((owner) => {
            const rows = visibleActors.filter((e) => e.actor.owner.key === owner.key).sort((a, b) => (a.actor.role === b.actor.role ? 0 : a.actor.role === "agent" ? -1 : 1));
            const motion = motionOf(owner.key);
            const passive = presence && rows.every((e) => firstStep.get(e.actor.id) === undefined);
            const glowT = Math.max(...rows.map((e) => firstStep.get(e.actor.id) ?? -Infinity));
            const glow = !reducedMotion && clock - glowT >= 0 && clock - glowT < GLOW_MS ? 1 - (clock - glowT) / GLOW_MS : 0;
            const chip = ownerChip(motion);
            const fxStyle = motionStyle(owner.key, motion, glow);
            if (layout.density === "dots") {
              const node = layout.nodes.get(owner.key);
              if (!node) return null;
              const r = layout.nodeRadius;
              const width = layout.compact ? 76 : 88;
              const first = rows[0]?.actor;
              const activity = rows.map((e) => acts.get(e.actor.id) ?? "idle").find((a) => a !== "idle") ?? "idle";
              const status = rows.map((e) => flash.get(e.actor.id)).find(Boolean);
              const dense = visibleOwners.length > 24;
              return (
                <div
                  key={owner.key}
                  className="af-dotnode"
                  data-passive={passive ? "" : undefined}
                  data-leaving={motion.leftT !== undefined ? "" : undefined}
                  data-dim={dimmed(rows.map((e) => e.actor.id)) ? "" : undefined}
                  data-quiet={dense && activity === "idle" && !status && !chip ? "" : undefined}
                  style={{ width, transform: `translate(${node.x - width / 2}px, ${node.y - r}px)`, ...fxStyle }}
                >
                  <button
                    type="button"
                    className="af-dot-avatar"
                    aria-pressed={selection?.kind === "actor" && rows.some((e) => e.actor.id === selection.id)}
                    aria-label={`${owner.label}: ${rows.map((e) => e.actor.label).join(", ")}. ${activityLabels[activity]}`}
                    data-activity={activity}
                    data-flash={status ? "" : undefined}
                    style={{ width: r * 2, height: r * 2, ...(status ? ({ "--af-flash": statusColor[status] } as CSSProperties) : {}) }}
                    onClick={() => first && select({ kind: "actor", id: first.id })}
                  >
                    {initial(owner.label)}
                    {rows.length > 1 ? <span className="af-dot-count">{rows.length}</span> : null}
                  </button>
                  <span className="af-dot-label">{shortLabel(owner.label)}</span>
                  {chip ? <span className="af-dot-chip" style={{ opacity: chip.opacity }}><span className="af-tag" style={chip.style}>{chip.label}</span></span> : null}
                </div>
              );
            }
            const card = layout.cards.get(owner.key);
            if (!card) return null;
            return (
              <section
                key={owner.key}
                className="af-card"
                aria-label={`Titular ${owner.label}`}
                data-passive={passive ? "" : undefined}
                data-leaving={motion.leftT !== undefined ? "" : undefined}
                data-dim={dimmed(rows.map((e) => e.actor.id)) ? "" : undefined}
                style={{ width: card.w, height: card.h, transform: `translate(${card.x}px, ${card.y}px)`, ["--af-head" as string]: "40px", ["--af-row" as string]: `${layout.slots.get(rows[0]?.actor.id ?? "")?.h ?? 34}px`, ...fxStyle }}
              >
                <div className="af-card-head">
                  <span className="af-avatar" aria-hidden="true">{initial(owner.label)}</span>
                  <span className="af-who">
                    <b>{shortLabel(owner.label)}</b>
                    {owner.key.includes("@") ? <small>{owner.key}</small> : null}
                  </span>
                  {chip ? <span className="af-tag af-head-chip" style={{ ...chip.style, opacity: chip.opacity }}>{chip.label}</span> : null}
                </div>
                {rows.map((entry) => {
                  const { actor } = entry;
                  const status = flash.get(actor.id);
                  const activity = acts.get(actor.id) ?? "idle";
                  const rowLeft = entry.presence === "left";
                  return (
                    <button
                      key={actor.id}
                      type="button"
                      className="af-row"
                      aria-pressed={selection?.kind === "actor" && selection.id === actor.id}
                      aria-label={`${endpointLabel(actor)}${actor.channel ? `, ${actor.channel}` : ""}: ${rowLeft ? "salió de la red" : activityLabels[activity]}`}
                      data-human={actor.role === "owner" ? "" : undefined}
                      data-flash={status ? "" : undefined}
                      data-left={rowLeft ? "" : undefined}
                      style={status ? ({ "--af-flash": statusColor[status] } as CSSProperties) : undefined}
                      onClick={() => select({ kind: "actor", id: actor.id })}
                    >
                      <span className="af-icon"><ChannelIcon actor={actor} size={14} /></span>
                      <span className="af-row-label">{actor.role === "owner" ? "Titular" : actor.placeholder ? "Sin agente" : actor.label}</span>
                      {rowTag(entry, motion)}
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>

        {sidePanels ? (
        <div className="af-side">
          <Timeline log={recordLog} clock={clock} expansion={timelineExpansion} selectedId={selection?.kind === "event" ? selection.id : undefined}
            timeLabel={timeLabel} onSelect={pick} />
          <section className="af-panel af-detail" aria-label="Detalle">
            <p className="af-eyebrow">Detalle</p>
            {selectedEvent ? (
              <EventDetail entry={selectedEvent} flow={record} onSelect={pick} onReplayRequest={controls ? inspectRequest : undefined} timeLabel={timeLabel} actions={eventActions?.(selectedEvent.event)} />
            ) : selectedActor ? (
              <ActorDetail flow={flow} id={selectedActor.actor.id} activity={acts.get(selectedActor.actor.id) ?? "idle"} log={visibleLog} onSelect={(id) => setSelection({ kind: "event", id })} timeLabel={timeLabel} />
            ) : selection?.kind === "hub" ? (
              <HubDetail flow={flow} />
            ) : (
              <p>Selecciona un agente, el broker o un paso para ver sus metadatos. Nunca se muestra el contenido de las preguntas ni de las respuestas.</p>
            )}
          </section>
        </div>
        ) : null}
      </div>

      {!fillMode ? (
        <div className="af-legend" aria-label="Leyenda de estados">
          {(["allowed", "delivered", "denied", "blocked", "sanitized", "escalated", "expired"] as const).map((status) => (
            <Tag key={status} status={status} label={statusLabels[status]} dot />
          ))}
        </div>
      ) : null}
      </div>
      <div className="af-sr" aria-live="polite" aria-atomic="true">{announcement}</div>
    </div>
  );
}

const agentCount = (entries: { actor: FlowActor }[]) => entries.filter((e) => e.actor.role === "agent").length;
// Sin nombre visible, el titular se muestra por su dirección: la inicial sale de la parte local
// (sin el prefijo demo- de los perfiles ficticios) y la etiqueta corta es esa parte local.
const shortLabel = (label: string) => (label.includes("@") ? label.split("@")[0]! : label);
const initial = (label: string) => (shortLabel(label).replace(/^demo-/, "").trim()[0] ?? "?").toUpperCase();

function hubText(event: FlowEvent): string {
  const detail = stepDetail(event);
  const text = detail ? `${stepLabels[event.step]} · ${detail}` : stepLabels[event.step];
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function Tag({ status, label, dot }: { status: FlowStatus; label: string; dot?: boolean }) {
  const tone = statusTone[status];
  return (
    <span className="af-tag" style={{ color: tone.fg, background: tone.bg }}>
      {dot ? <span className="af-dot" /> : null}
      {label}
    </span>
  );
}

function route(event: FlowEvent): string {
  const name = (endpoint: FlowEvent["from"]) =>
    endpoint === BROKER ? "Broker" : endpoint.role === "owner" ? `${endpoint.owner.label} (titular)` : `${endpoint.owner.label} · ${endpoint.label}`;
  return event.from === event.to ? name(event.from) : `${name(event.from)} → ${name(event.to)}`;
}

// Keep expanded groups across hiding and reopening the panels.
function useTimelineExpansion(inspectMany: (ids: string[]) => void) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  function toggle(id: string, entries: AppliedEvent[]) {
    if (!openGroups.has(id)) inspectMany(entries.map((entry) => entry.event.id));
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return { openGroups, toggle };
}

function Timeline({ log, clock, selectedId, expansion, timeLabel, onSelect }: {
  log: AppliedEvent[];
  clock: number;
  selectedId?: string;
  expansion: ReturnType<typeof useTimelineExpansion>;
  timeLabel: (entry: AppliedEvent) => string;
  onSelect: (id: string) => void;
}) {
  const timeline = log.slice(-TIMELINE_LIMIT).reverse();
  // Entradas seguidas a la red (menos de 2 s entre una y otra) se agrupan: «3 personas se unieron».
  const timelineItems: AppliedEvent[][] = [];
  for (const entry of timeline) {
    const group = timelineItems[timelineItems.length - 1];
    const head = group?.[group.length - 1];
    if (group && head && entry.event.step === "joined" && head.event.step === "joined" && Math.abs(head.t - entry.t) < 2_000) group.push(entry);
    else timelineItems.push([entry]);
  }
  return (
    <section className="af-panel af-timeline" aria-label="Línea de tiempo">
      <p className="af-eyebrow">Línea de tiempo</p>
      {timeline.length === 0 ? <p className="af-placeholder">Los pasos aparecen aquí a medida que ocurren.</p> : null}
      <ol className="af-list">
        {timelineItems.map((entries) => {
          const newest = entries[0]!;
          const groupId = entries[entries.length - 1]!.event.id;
          return (
            <li key={entries.length === 1 ? newest.event.id : `group-${groupId}`} className={clock - newest.t < 600 ? "af-new" : undefined}>
              {entries.length === 1 ? (
                <StepButton entry={newest} current={selectedId === newest.event.id} timeLabel={timeLabel} onClick={() => onSelect(newest.event.id)} />
              ) : (
                <JoinGroup entries={entries} open={expansion.openGroups.has(groupId)} onToggle={() => expansion.toggle(groupId, entries)}
                  timeLabel={timeLabel} onSelect={onSelect} selectedId={selectedId} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StepButton({ entry, current, timeLabel, onClick }: { entry: AppliedEvent; current: boolean; timeLabel: (entry: AppliedEvent) => string; onClick: () => void }) {
  const { event } = entry;
  const detail = stepDetail(event);
  return (
    <button type="button" className="af-item" aria-current={current} onClick={onClick} aria-label={describeEvent(event)}>
      <time>{timeLabel(entry)}</time>
      <span className="af-item-main">
        <b>{stepLabels[event.step]}{detail ? <span style={{ color: "var(--af-muted)", fontWeight: 400 }}> · {detail}</span> : null}</b>
        <small>{route(event)}</small>
      </span>
      <StepTag event={event} />
    </button>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function EventDetail({ entry, flow, onSelect, onReplayRequest, timeLabel, actions }: { entry: AppliedEvent; flow: FlowState; onSelect: (id: string) => void; onReplayRequest?: (requestId: string) => void; timeLabel: (entry: AppliedEvent) => string; actions?: ReactNode }) {
  const { event } = entry;
  const { meta } = event;
  const chain = event.requestId ? (flow.requests.get(event.requestId)?.events ?? []) : [];
  const byId = new Map(flow.log.map((e) => [e.event.id, e]));
  return (
    <>
      <div className="af-detail-title">
        <h4>{stepLabels[event.step]}</h4>
        <StepTag event={event} />
      </div>
      <dl className="af-dl">
        <Row label="Ruta" value={route(event)} />
        <Row label="Tool" value={meta.tool ? `${meta.tool}${toolLabel(meta.tool) !== meta.tool ? ` · ${toolLabel(meta.tool)}` : ""}` : undefined} />
        <Row label="Categoría" value={categoryLabel(meta.category)} />
        <Row label="Decisión" value={meta.decision} />
        <Row label="Regla" value={meta.rule ? `${meta.rule} · ${ruleLabel(meta.rule)}` : undefined} />
        <Row label="Resultado" value={meta.outcome ? `${meta.outcome} · ${outcomeLabel(meta.outcome)}` : undefined} />
        <Row label="Escalada" value={meta.escalated === undefined ? undefined : meta.escalated ? "sí" : "no"} />
        <Row label="Descartados" value={meta.fieldsDropped?.join(", ")} />
        <Row label="Códigos" value={meta.flags?.join(", ")} />
        <Row label="Código" value={meta.code} />
        <Row label="Intento" value={meta.attempt} />
        <Row label="HTTP" value={meta.httpStatus} />
        <Row label="Latencia" value={meta.latencyMs !== undefined ? `${meta.latencyMs} ms` : undefined} />
        <Row label="Servicio" value={meta.service} />
        <Row label="Solicitud" value={event.requestId} />
        <Row label="Traza" value={event.traceId} />
        <Row label="Hora" value={timeLabel(entry)} />
      </dl>
      {actions ? <div className="af-detail-actions">{actions}</div> : null}
      {chain.length > 1 ? (
        <div>
          <div className="af-detail-title" style={{ marginBottom: 8 }}>
            <p className="af-eyebrow">Cadena de la solicitud</p>
            {onReplayRequest && event.requestId ? (
              <button type="button" className="af-link" onClick={() => onReplayRequest(event.requestId!)}>
                Repetir la solicitud
              </button>
            ) : null}
          </div>
          <ol className="af-chain">
            {chain.map((id) => {
              const step = byId.get(id);
              return step ? (
                <li key={id}>
                  <StepButton entry={step} current={id === event.id} timeLabel={timeLabel} onClick={() => onSelect(id)} />
                </li>
              ) : null;
            })}
          </ol>
        </div>
      ) : null}
    </>
  );
}

function ActorDetail({ flow, id, activity, log, onSelect, timeLabel }: { flow: FlowState; id: string; activity: Activity; log: AppliedEvent[]; onSelect: (id: string) => void; timeLabel: (entry: AppliedEvent) => string }) {
  const entry = flow.actors.get(id);
  if (!entry) return null;
  const { actor } = entry;
  const mine = log.filter((e) => {
    const { fromId, toId } = eventEndpoints(flow, e.event);
    return fromId === id || toId === id;
  });
  return (
    <>
      <div className="af-detail-title">
        <h4>{actor.role === "owner" ? `${actor.owner.label} · titular` : `${actor.label} de ${actor.owner.label}`}</h4>
      </div>
      <dl className="af-dl">
        <Row label="Titular" value={actor.owner.label} />
        <Row label="Dirección" value={actor.owner.key.includes("@") ? actor.owner.key : undefined} />
        <Row label="Canal" value={actor.channel} />
        <Row label="Estado" value={activityLabels[activity]} />
        <Row label="Pasos" value={mine.length} />
      </dl>
      {mine.length > 0 ? (
        <ol className="af-chain">
          {mine.slice(-5).reverse().map((e) => (
            <li key={e.event.id}>
              <StepButton entry={e} current={false} timeLabel={timeLabel} onClick={() => onSelect(e.event.id)} />
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

function HubDetail({ flow }: { flow: FlowState }) {
  const tracks = [...flow.requests.values()];
  const count = (predicate: (status: FlowStatus) => boolean) => tracks.filter((t) => predicate(t.status)).length;
  return (
    <>
      <div className="af-detail-title">
        <h4>Broker de Sideband</h4>
      </div>
      <p>Evalúa la política de cada pregunta, firma la solicitud, avisa al agente del destinatario, sanea su respuesta y entrega solo los campos permitidos.</p>
      <dl className="af-dl">
        <Row label="Solicitudes" value={tracks.length} />
        <Row label="Abiertas" value={tracks.filter((t) => t.phase !== "closed").length} />
        <Row label="Entregadas" value={count((s) => s === "delivered")} />
        <Row label="Denegadas" value={count((s) => s === "denied")} />
        <Row label="Expiradas" value={count((s) => s === "expired")} />
      </dl>
    </>
  );
}

const svgIcon = { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": true } as const;
const PlayIcon = () => <svg {...svgIcon}><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>;
const PauseIcon = () => <svg {...svgIcon}><path d="M5 3.5v9M11 3.5v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const ReplayIcon = () => <svg {...svgIcon}><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.8h2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const PanelIcon = () => <svg {...svgIcon}><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 3v10" stroke="currentColor" strokeWidth="1.6" /></svg>;
const ExpandIcon = () => <svg {...svgIcon}><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const ShrinkIcon = () => <svg {...svgIcon}><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const FilterIcon = () => <svg {...svgIcon}><path d="M2.5 4h11M4.5 8h7M6.5 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;

function Outline({ box, inflate, opacity, dashed }: { box: Box; inflate: number; opacity: number; dashed: boolean }) {
  const common = { className: dashed ? "af-ghost" : "af-ripple", opacity: Math.max(0, opacity) };
  if (box.round) return <circle {...common} cx={box.x + box.w / 2} cy={box.y + box.h / 2} r={box.w / 2 + inflate} />;
  return <rect {...common} x={box.x - inflate} y={box.y - inflate} width={box.w + inflate * 2} height={box.h + inflate * 2} rx={20 + inflate} />;
}

function NetworkCounter({ present, active, bump, inline }: { present: number; active: number; bump: boolean; inline?: boolean }) {
  return (
    <span className={inline ? "af-net af-net-inline" : "af-net"} data-bump={bump ? "" : undefined} role="status" aria-label={`${present} en la red, ${active} conversando`}>
      <span className="af-dot" />
      <span className="af-roll" key={`p${present}`}>{present}</span> en la red
      <span aria-hidden="true">·</span>
      <span className="af-roll" key={`a${active}`}>{active}</span> conversando
    </span>
  );
}

function JoinGroup({ entries, open, onToggle, timeLabel, onSelect, selectedId }: {
  entries: AppliedEvent[];
  open: boolean;
  onToggle: () => void;
  timeLabel: (entry: AppliedEvent) => string;
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const names = entries.map((e) => (e.event.from === BROKER ? "" : e.event.from.owner.label)).filter(Boolean);
  const newest = entries[0]!;
  return (
    <>
      <button type="button" className="af-item" aria-expanded={open} onClick={onToggle} aria-label={`${entries.length} personas se unieron a la red: ${names.join(", ")}`}>
        <time>{timeLabel(newest)}</time>
        <span className="af-item-main">
          <b>{entries.length} personas se unieron</b>
          <span className="af-group-names">{names.join(", ")}</span>
        </span>
        <span className="af-tag" style={{ color: "var(--af-accent-ink)", background: "var(--af-accent-soft)" }}>{open ? "Ocultar" : "Ver"}</span>
      </button>
      {open ? (
        <ol className="af-chain" style={{ paddingLeft: 16 }}>
          {entries.map((e) => (
            <li key={e.event.id}>
              <StepButton entry={e} current={selectedId === e.event.id} timeLabel={timeLabel} onClick={() => onSelect(e.event.id)} />
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

function StepTag({ event }: { event: FlowEvent }) {
  if (event.step === "joined") return <span className="af-tag" style={{ color: "var(--af-accent-ink)", background: "var(--af-accent-soft)" }}>Nuevo</span>;
  if (event.step === "left") return <span className="af-tag" style={{ color: "var(--af-muted)", background: "var(--af-chip-active)" }}>Salió</span>;
  return <Tag status={event.status} label={statusLabels[event.status]} />;
}
