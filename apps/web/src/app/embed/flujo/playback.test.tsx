// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentFlow, describeEvent, scheduleReplay, type FlowEvent } from "@team-31/agent-flow";
import { scenarioEvents } from "@team-31/agent-flow/scenario";

const events = scenarioEvents().filter((event) => !event.meta.snapshot && event.step !== "joined").slice(0, 3);
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const timeline = () => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Línea de tiempo"] .af-item')];
const render = (mode: "live" | "replay", items: readonly FlowEvent[], autoPlay = true) =>
  act(() => root.render(<AgentFlow mode={mode} events={items} autoPlay={autoPlay} />));
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

const playbackButton = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find((button) => button.textContent.trim() === label)!;

it.each([
  ["toolbar", false], ["toolbar", true], ["keyboard", false], ["keyboard", true],
] as const)("resumes the saved replay position via %s (previously paused=%s)", async (control, paused) => {
  const times = scheduleReplay(events);
  await render("replay", events);
  await advance(times[1]! + 32);
  if (paused) await act(() => playbackButton("Pausar").click());
  expect(timeline()).toHaveLength(2);
  await act(() => timeline()[1]!.click()); // El paso más antiguo.

  const resume = playbackButton("Reanudar");
  await act(() => {
    if (control === "toolbar") resume.click();
    else resume.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
  });

  expect(host.textContent).not.toContain("Continuar");
  expect(timeline()).toHaveLength(2);
  await advance(times[2]! - times[1]!);
  expect(timeline().map((button) => button.getAttribute("aria-label"))).toEqual(events.map(describeEvent).reverse());
});

it("resets playback when the replay is replaced", async () => {
  await render("replay", events.slice(0, 1));
  await advance(1_000);
  const first = timeline()[0]!.getAttribute("aria-label");
  await render("replay", events.slice(1, 2));
  expect(timeline()).toHaveLength(0);
  await advance(1_000);
  expect(timeline()).toHaveLength(1);
  expect(timeline()[0]!.getAttribute("aria-label")).not.toBe(first);
});

it("holds new live events during inspection and plays each once when returning", async () => {
  await render("live", events.slice(0, 1));
  await advance(1_000);
  await act(() => timeline()[0]!.click());

  await render("live", events.slice(0, 2));
  await render("live", events);
  await advance(2_000);
  const inspection = host.querySelector<HTMLElement>(".af-inspect")!;
  expect(inspection.textContent).toContain("2 nuevos");
  expect(timeline().map((item) => item.getAttribute("aria-label"))).toEqual([describeEvent(events[0]!)]);

  const back = inspection.querySelector("button")!;
  expect(back.textContent).toBe("Volver al vivo");
  await act(() => back.click());
  await advance(1_000);
  expect(host.querySelector(".af-inspect")).toBeNull();
  expect(timeline().map((item) => item.getAttribute("aria-label"))).toEqual(events.map(describeEvent).reverse());
});

it("returns to live playback when the host trims the event under inspection", async () => {
  await render("live", events.slice(0, 2));
  await advance(1_000);
  expect(timeline()).toHaveLength(2);
  await act(() => timeline()[1]!.click());
  expect(host.textContent).toContain("Volver al vivo");
  await render("live", events.slice(1));
  await advance(1_000);
  expect(host.textContent).not.toContain("Volver al vivo");
  expect(timeline().map((button) => button.getAttribute("aria-label"))).toEqual(events.map(describeEvent).reverse());
});

it.each([true, false])("restores playback after replacing inspected history (autoPlay=%s)", async (autoPlay) => {
  await render("live", events.slice(0, 1), autoPlay);
  await advance(1_000);
  await act(() => timeline()[0]!.click());
  expect(host.textContent).toContain("Volver al vivo");

  const replacement = events.slice(1);
  await render("live", replacement, autoPlay);
  await advance(1_000);

  expect(host.textContent).not.toContain("Volver al vivo");
  const expected = autoPlay ? replacement : replacement.slice(0, 1);
  expect(timeline().map((button) => button.getAttribute("aria-label"))).toEqual(expected.map(describeEvent).reverse());
});

it("pauses the replay offscreen and resumes from the same step when visible", async () => {
  let setVisible: ((visible: boolean) => void) | undefined;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private notify: (entries: { isIntersecting: boolean }[]) => void) {}
    observe(target: Element) {
      expect(target).toBe(host.firstElementChild);
      setVisible = (visible) => this.notify([{ isIntersecting: visible }]);
    }
    disconnect() { setVisible = undefined; }
  });

  const [first, second] = scheduleReplay(events);
  await render("replay", events);
  await advance(first! + 32);
  expect(timeline()).toHaveLength(1);
  setVisible!(false);
  await advance(second!);
  expect(timeline()).toHaveLength(1);
  setVisible!(true);
  await advance(second! - first!);
  expect(timeline().map((item) => item.getAttribute("aria-label"))).toEqual(events.slice(0, 2).map(describeEvent).reverse());
  await act(() => root.render(null));
  expect(setVisible).toBeUndefined();
});

it("fits the embedded graph to the limiting dimension and updates the map on resize", async () => {
  const observed = new Map<Element, () => void>();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private notify: () => void) {}
    observe(target: Element) { observed.set(target, this.notify); }
    disconnect() { observed.clear(); }
  });
  await act(() => root.render(<AgentFlow mode="replay" events={events} autoPlay={false} fill />));
  const graph = host.firstElementChild as HTMLElement;
  const frame = graph.querySelector<HTMLElement>(".af-frame")!;
  const layout = frame.querySelector<HTMLElement>(".af-layout")!;
  const stage = layout.querySelector<HTMLElement>(".af-stage")!;

  const resize = async (element: HTMLElement, width: number, height: number) => {
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: width },
      clientHeight: { configurable: true, value: height },
    });
    await act(() => observed.get(element)!());
  };
  await resize(graph, 2160, 1620); // Width limits the scale.
  expect(frame.style.transform).toBe("scale(1.5)");
  expect(frame.style.width).toBe("1440px");
  await resize(graph, 2880, 972); // Height now limits it.
  expect(frame.style.transform).toBe("scale(1.2)");
  expect(frame.style.height).toBe("810px");
  await resize(graph, 3840, 2160);
  expect(frame.style.transform).toBe("scale(1.75)");
  await resize(graph, 800, 600);
  expect(frame.style.transform).toBe("");

  await resize(stage, 780, 450);
  await resize(layout, 800, 520);
  expect(stage.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 780 520");
  await act(() => root.render(null));
  expect(observed.size).toBe(0);
});

const fullscreenButton = () => host.querySelector<HTMLButtonElement>('button[aria-label*="pantalla completa" i]')!;

it("tracks native fullscreen for this graph and follows an external exit", async () => {
  await render("replay", events, false);
  const graph = host.firstElementChild as HTMLElement;
  let current: Element | null = null;
  const change = (element: Element | null) => {
    current = element;
    document.dispatchEvent(new Event("fullscreenchange"));
  };
  const request = vi.fn(async () => change(graph));
  const exit = vi.fn(async () => change(null));
  Object.defineProperty(graph, "requestFullscreen", { value: request });
  Object.defineProperties(document, {
    fullscreenEnabled: { configurable: true, value: true },
    fullscreenElement: { configurable: true, get: () => current },
    exitFullscreen: { configurable: true, value: exit },
  });
  try {
    await act(() => change(document.body));
    expect(fullscreenButton().getAttribute("aria-pressed")).toBe("false");
    await act(() => change(null));
    await act(() => fullscreenButton().click());
    expect(request).toHaveBeenCalledOnce();
    expect(fullscreenButton().getAttribute("aria-pressed")).toBe("true");
    await act(() => change(null)); // The viewer leaves via the browser.
    expect(fullscreenButton().getAttribute("aria-pressed")).toBe("false");
    await act(() => fullscreenButton().click());
    await act(() => fullscreenButton().click());
    expect(exit).toHaveBeenCalledOnce();
    expect(fullscreenButton().getAttribute("aria-pressed")).toBe("false");
  } finally {
    Reflect.deleteProperty(document, "fullscreenEnabled");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
  }
});

it.each([false, true])("opens and exits expanded mode when native fullscreen is unavailable (API enabled=%s)", async (enabled) => {
  await render("replay", events, false);
  const graph = host.firstElementChild as HTMLElement;
  const request = vi.fn().mockRejectedValue(new Error("Fullscreen denied"));
  Object.defineProperty(graph, "requestFullscreen", { value: request });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: enabled });
  try {
    await act(() => fullscreenButton().click());
    expect(request).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(fullscreenButton().getAttribute("aria-pressed")).toBe("true");
    expect(graph.classList.contains("af-expanded")).toBe(true);
    await act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(fullscreenButton().getAttribute("aria-pressed")).toBe("false");
    expect(graph.classList.contains("af-expanded")).toBe(false);
  } finally {
    Reflect.deleteProperty(document, "fullscreenEnabled");
  }
});
