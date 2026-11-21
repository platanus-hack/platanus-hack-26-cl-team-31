import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { describeEvent } from "./labels.js";
import { BROKER, type FlowEvent } from "./model.js";
import { LABEL_MS, scheduleLive, scheduleReplay } from "./schedule.js";
import { emptyFlowState, foldFlow, reduceFlow, type AppliedEvent, type FlowState } from "./state.js";

type Inspect = { first: AppliedEvent; start: number; end: number; focus: { actors: string[]; ids: string[] } };

type PlaybackOptions = {
  flowEvents: readonly FlowEvent[];
  mode: "replay" | "live";
  loop: boolean;
  autoPlay: boolean;
  initialSpeed: number;
  controls: boolean;
  reducedMotion: boolean;
  visibleRef: RefObject<boolean>;
  selectEvent: (id: string | null) => void;
};

export function useFlowPlayback({
  flowEvents, mode, loop, autoPlay, initialSpeed, controls, reducedMotion, visibleRef, selectEvent,
}: PlaybackOptions) {
  const [paused, setPaused] = useState(!autoPlay);
  const [speed, setSpeed] = useState<number>(() => Math.min(4, Math.max(0.25, initialSpeed)));
  const [flow, setFlow] = useState<FlowState>(emptyFlowState);
  const [clock, setClock] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  // Inspección del pasado: se reconstruye el estado justo antes del evento y se repite su animación.
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [pending, setPending] = useState(0);
  const [history, setHistory] = useState<FlowState | null>(null);
  const [seeking, setSeeking] = useState(false);
  const inspectRef = useRef<(Inspect & { until: number }) | null>(null);
  const savedRef = useRef<{ clock: number; cursor: number; paused: boolean } | null>(null);
  const foldCache = useRef(new Map<number, FlowState>());
  // En vivo el host puede descartar los pasos más viejos (ventana): este es el estado tras ellos.
  const baseRef = useRef<FlowState | undefined>(undefined);

  const clockRef = useRef(0);
  const flowRef = useRef(flow);
  const cursorRef = useRef(0);
  const scheduleRef = useRef<number[]>([]);
  const eventsRef = useRef<readonly FlowEvent[]>([]);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  const lastAnnounce = useRef(0);
  useEffect(() => {
    pausedRef.current = paused;
    speedRef.current = speed;
  }, [paused, speed]);

  const scheduleLiveTail = (events: readonly FlowEvent[]) => {
    for (let i = scheduleRef.current.length; i < events.length; i++) {
      scheduleRef.current.push(scheduleLive(scheduleRef.current[i - 1], clockRef.current, 320, Boolean(events[i]!.meta.snapshot)));
    }
  };

  const reset = useCallback(() => {
    if (savedRef.current) setPaused(savedRef.current.paused);
    inspectRef.current = null;
    savedRef.current = null;
    setInspect(null);
    setHistory(null);
    setPending(0);
    clockRef.current = 0;
    cursorRef.current = 0;
    baseRef.current = undefined;
    foldCache.current = new Map();
    flowRef.current = emptyFlowState();
    setFlow(flowRef.current);
    setClock(0);
    selectEvent(null);
  }, [selectEvent]);

  // Calendario: completo en repetición, incremental en vivo.
  useEffect(() => {
    const events = flowEvents;
    const previous = eventsRef.current;
    if (mode === "replay") {
      eventsRef.current = events;
      // Un arreglo nuevo con los mismos pasos (p. ej. scenarioEvents() en cada render) no reinicia.
      const same = previous.length === events.length && previous.every((event, i) => event.id === events[i]!.id);
      if (same && scheduleRef.current.length === events.length) return;
      scheduleRef.current = scheduleReplay(events);
      reset();
      return;
    }
    // Ventana: el host quitó los `dropped` pasos más viejos y conservó el resto en orden. El estado
    // ya los contiene, así que solo se recorta el calendario: nada se reinicia.
    const head = events[0]?.id;
    const dropped = previous.length > 0 && head !== undefined && head !== previous[0]!.id ? previous.findIndex((event) => event.id === head) : 0;
    if (dropped > 0) {
      if (inspectRef.current) exitInspectRef.current();
      scheduleLiveTail(previous);
      let next = flowRef.current;
      for (let i = cursorRef.current; i < dropped; i++) next = reduceFlow(next, previous[i]!, scheduleRef.current[i]!);
      if (next !== flowRef.current) {
        flowRef.current = next;
        setFlow(next);
      }
      baseRef.current = foldFlow(previous, scheduleRef.current, dropped, foldCache.current, 50, baseRef.current);
      foldCache.current = new Map();
      scheduleRef.current = scheduleRef.current.slice(dropped);
      cursorRef.current = Math.max(0, cursorRef.current - dropped);
    } else if (events.length < scheduleRef.current.length || (dropped < 0 && events.length > 0)) {
      scheduleRef.current = [];
      reset();
    }
    eventsRef.current = events;
    // Mientras se inspecciona el pasado, lo nuevo espera sin programarse.
    if (inspectRef.current) {
      setPending(events.length - scheduleRef.current.length);
      return;
    }
    scheduleLiveTail(events);
  }, [flowEvents, mode, reset]);

  // Bucle de animación.
  useEffect(() => {
    let frame = 0;
    let last = typeof performance !== "undefined" ? performance.now() : 0;
    let renderedClock = -1;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const schedule = scheduleRef.current;
      const list = eventsRef.current;
      const inspecting = inspectRef.current;
      if (inspecting) {
        // Repite el tramo inspeccionado y se queda en su estado final.
        if (clockRef.current < inspecting.until) clockRef.current = Math.min(inspecting.until, clockRef.current + dt * speedRef.current);
      } else if (!pausedRef.current && (visibleRef.current || mode === "live")) {
        let rate = speedRef.current;
        // En vivo, si se acumula una ráfaga, se acelera hasta alcanzarla.
        const lag = mode === "live" && schedule.length > 0 ? schedule[schedule.length - 1]! - clockRef.current : 0;
        if (lag > 3_000) rate *= 1 + lag / 1_500;
        clockRef.current += dt * rate;
      }
      let next = flowRef.current;
      let applied: FlowEvent | undefined;
      const limit = inspecting ? Math.min(list.length, inspecting.end + 1) : list.length;
      while (cursorRef.current < limit && cursorRef.current < schedule.length && schedule[cursorRef.current]! <= clockRef.current) {
        const event = list[cursorRef.current]!;
        next = reduceFlow(next, event, schedule[cursorRef.current]!);
        applied = event;
        cursorRef.current++;
      }
      if (applied) {
        flowRef.current = next;
        setFlow(next);
        if (now - lastAnnounce.current > 1_500) {
          lastAnnounce.current = now;
          setAnnouncement(describeEvent(applied));
        }
      }
      if (!inspecting && mode === "replay" && loop && list.length > 0 && cursorRef.current >= list.length && clockRef.current > schedule[schedule.length - 1]! + 5_000) {
        clockRef.current = 0;
        cursorRef.current = 0;
        flowRef.current = emptyFlowState();
        setFlow(flowRef.current);
      }
      // Solo se vuelve a dibujar si hay algo animándose.
      const log = flowRef.current.log;
      const lastT = log.length > 0 ? log[log.length - 1]!.t : -Infinity;
      const animating = clockRef.current - lastT < LABEL_MS + 100;
      if (applied || (animating && clockRef.current !== renderedClock)) {
        renderedClock = clockRef.current;
        setClock(clockRef.current);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, loop, visibleRef]);

  // ---------- Inspección del pasado ----------
  const indexOf = (id: string) => eventsRef.current.findIndex((e) => e.id === id);
  const seekTo = (cursor: number, time: number) => {
    const frame = foldFlow(eventsRef.current, scheduleRef.current, cursor, foldCache.current, 50, baseRef.current);
    flowRef.current = frame;
    cursorRef.current = cursor;
    clockRef.current = time;
    setFlow(frame);
    setClock(time);
  };
  const startInspect = (start: number, end: number, focus: Inspect["focus"]) => {
    const events = eventsRef.current;
    const times = scheduleRef.current;
    if (!controls || start < 0 || end < start || end >= times.length) return;
    if (!inspectRef.current) {
      savedRef.current = { clock: clockRef.current, cursor: cursorRef.current, paused: pausedRef.current };
      setHistory(flowRef.current);
    }
    // Inspeccionar pausa la reproducción: la línea de tiempo deja de moverse y los clics son estables.
    setPaused(true);
    // Un salto en el tiempo no anima el reacomodo de tarjetas: se ubican de inmediato.
    setSeeking(true);
    window.setTimeout(() => setSeeking(false), 90);
    const until = times[end]! + LABEL_MS - 300;
    const next = { start, end, focus, until, first: { event: events[start]!, t: times[start]! } };
    inspectRef.current = next;
    // Con movimiento reducido se salta al estado final con un resaltado estático.
    seekTo(start, reducedMotion ? until : times[start]! - 350);
    setInspect(next);
    setPending(Math.max(0, events.length - times.length));
  };
  const exitInspect = () => {
    const saved = savedRef.current;
    if (!inspectRef.current || !saved) return;
    inspectRef.current = null;
    savedRef.current = null;
    seekTo(saved.cursor, saved.clock);
    if (mode === "live") scheduleLiveTail(eventsRef.current);
    setInspect(null);
    setPending(0);
    setHistory(null);
    setPaused(saved.paused);
    setSeeking(true);
    window.setTimeout(() => setSeeking(false), 90);
  };
  const exitInspectRef = useRef(exitInspect);
  useEffect(() => {
    exitInspectRef.current = exitInspect;
  });
  const focusOf = (indices: number[]): Inspect["focus"] => {
    const actors = new Set<string>();
    for (const i of indices) {
      const event = eventsRef.current[i];
      if (!event) continue;
      for (const end of [event.from, event.to]) if (end !== BROKER) actors.add(end.id);
    }
    return { actors: [...actors], ids: indices.map((i) => eventsRef.current[i]?.id ?? "") };
  };
  const inspectEvent = (id: string) => {
    const i = indexOf(id);
    if (i >= 0) startInspect(i, i, focusOf([i]));
  };
  const inspectMany = (ids: string[]) => {
    const indices = ids.map(indexOf).filter((i) => i >= 0).sort((a, b) => a - b);
    if (indices.length > 0) startInspect(indices[0]!, indices[indices.length - 1]!, focusOf(indices));
  };
  const inspectRequest = (requestId: string) =>
    inspectMany(eventsRef.current.filter((e, i) => e.requestId === requestId && scheduleRef.current[i] !== undefined).map((e) => e.id));
  // ← y →: paso anterior y siguiente (sin la foto inicial de la red).
  const stepInspect = (direction: -1 | 1) => {
    const events = eventsRef.current;
    let i = inspectRef.current ? (direction < 0 ? inspectRef.current.start : inspectRef.current.end) + direction : cursorRef.current - 1;
    while (i >= 0 && i < scheduleRef.current.length && events[i]?.meta.snapshot) i += direction;
    if (i < 0 || i >= scheduleRef.current.length || (!inspectRef.current && direction > 0)) return;
    const event = events[i]!;
    selectEvent(event.id);
    startInspect(i, i, focusOf([i]));
  };

  return {
    flow, clock, paused, setPaused, speed, setSpeed, history, seeking, announcement, inspect, pending,
    reset, inspectEvent, inspectMany, inspectRequest, exitInspect, stepInspect,
  };
}
