// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentFlow, type FlowEvent } from "@team-31/agent-flow";
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
const render = (mode: "live" | "replay", items: readonly FlowEvent[]) =>
  act(() => root.render(<AgentFlow mode={mode} events={items} />));
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

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
  expect(timeline()).toHaveLength(3);
});
