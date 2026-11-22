// @vitest-environment happy-dom
import type { TimelineItem } from "@shared/contract"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { expect, it } from "vitest"

import { formatDuration } from "@/lib/format"
import { Timeline } from "./timeline"
import { TooltipProvider } from "./ui/tooltip"

const created: TimelineItem = {
  at: "2026-05-12T12:00:00.000Z",
  source: "request_event",
  kind: "created",
  name: "created",
  service: "broker",
  status: "awaiting_agent",
  level: "info",
  durationMs: null,
  errorId: null,
  traceId: null,
  attrs: {},
}

const wake: TimelineItem = {
  at: "2026-05-12T12:00:00.250Z",
  source: "telemetry",
  kind: "span",
  name: "wake.attempt",
  service: "worker",
  status: null,
  level: "error",
  durationMs: 12,
  errorId: "error/uno?fase=aviso",
  traceId: "traza/dos#aviso",
  attrs: { attempt: 0, delivered: false, reason: "", retry: null },
}

function renderTimeline(items: TimelineItem[]) {
  const host = document.createElement("div")
  host.innerHTML = renderToStaticMarkup(
    <MemoryRouter>
      <TooltipProvider>
        <Timeline items={items} />
      </TooltipProvider>
    </MemoryRouter>
  )
  return host
}

it("indica cuando la solicitud todavía no tiene eventos", () => {
  expect(renderTimeline([]).textContent).toBe("Sin eventos.")
})

it("mide cada evento desde el primero y conserva la duración del intento", () => {
  const closed = {
    ...created,
    name: "closed",
    status: "delivery_failed",
    at: "2026-05-12T12:00:01.500Z",
  }
  const rows = renderTimeline([created, wake, closed]).querySelectorAll("li")
  expect(
    Array.from(rows, (row) => row.querySelector("time")?.dateTime)
  ).toEqual([created.at, wake.at, closed.at])
  expect(rows[0]!.textContent).toContain("+0 ms")
  expect(rows[1]!.textContent).toContain("+250 ms")
  expect(rows[1]!.textContent).toContain("12 ms")
  expect(rows[2]!.textContent).toContain(`+${formatDuration(1500)}`)
})

it("conserva cero y falso entre los atributos y omite los valores vacíos", () => {
  const text = renderTimeline([wake]).textContent
  expect(text).toContain("attempt=0")
  expect(text).toContain("delivered=false")
  expect(text).not.toContain("reason=")
  expect(text).not.toContain("retry=")
})

it("enlaza el error y la traza del evento con sus identificadores completos", () => {
  const rows = renderTimeline([created, wake]).querySelectorAll("li")
  expect(rows[0]!.querySelector("a")).toBeNull()
  const links = Array.from(rows[1]!.querySelectorAll("a"), (link) => [
    link.textContent,
    link.getAttribute("href"),
  ])
  expect(links).toEqual([
    ["error", "/errores/error%2Funo%3Ffase%3Daviso"],
    ["traza", "/trazas/traza%2Fdos%23aviso"],
  ])
})
