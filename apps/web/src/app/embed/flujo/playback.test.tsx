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
