// @vitest-environment happy-dom
import type { ActivityItem } from "@team-31/protocol";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import ActivityPage from "./page";
import { readActivity } from "./read-activity";

vi.mock("./read-activity", () => ({ readActivity: vi.fn() }));
afterEach(() => vi.resetAllMocks());

async function renderActivity(query?: string) {
  const searchParams = Promise.resolve(query === undefined ? {} : { page: query });
  const stream = await renderToReadableStream(<ActivityPage params={Promise.resolve({})} searchParams={searchParams} />);
  await stream.allReady;
  const container = document.createElement("div");
  container.innerHTML = await new Response(stream).text();
  return container;
}

it("muestra el historial vacío sin enlaces de paginación", async () => {
  vi.mocked(readActivity).mockResolvedValue({ page: 1, items: [], hasNext: false });
  const view = await renderActivity();
  expect(view.textContent).toContain("Todavía no hay actividad");
  expect(view.querySelector("nav")).toBeNull();
});

it.each([
  { page: 1, hasNext: true, links: [["Anteriores ›", "/activity?page=2"]] },
  { page: 2, hasNext: true, links: [["‹ Más recientes", "/activity"], ["Anteriores ›", "/activity?page=3"]] },
  { page: 3, hasNext: false, links: [["‹ Más recientes", "/activity?page=2"]] },
])("ofrece los destinos disponibles desde la página $page", async ({ page, hasNext, links }) => {
  const item = {
    requestId: "solicitud", from: "bruno@sideband.app", to: "ana@sideband.app",
    direction: "received", tool: "question", status: "answered", events: [],
    createdAt: "2026-11-21T12:00:00Z", expiresAt: "2026-11-21T13:00:00Z",
  } satisfies ActivityItem;
  vi.mocked(readActivity).mockResolvedValue({ page, hasNext, items: [item] });
  const query = page === 1 ? undefined : String(page);
  const view = await renderActivity(query);

  expect(readActivity).toHaveBeenCalledWith(query);
  expect(view.querySelector("li button")?.textContent).toContain(item.from);
  const nav = view.querySelector('nav[aria-label="Páginas de actividad"]');
  expect(nav?.textContent).toContain(`Página ${page}`);
  expect(Array.from(nav!.querySelectorAll("a"), (link) => [link.textContent, link.getAttribute("href")])).toEqual(links);
});
