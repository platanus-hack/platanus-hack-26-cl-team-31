import { afterEach, expect, it, vi } from "vitest"
import { api, probeDevLogin, signInWithGoogle, signOut, subscribeLive, subscribeFlow } from "./api"

afterEach(() => vi.unstubAllGlobals())

it.each(["{", "{}"])("conserva el estado y el errorId de una respuesta inválida", async (body) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
    status: 201, headers: { "X-Error-Id": "error-123" },
  })))
  await expect(api("session")).rejects.toMatchObject({
    code: "invalid_response", status: 201, errorId: "error-123",
  })
})

it("distingue dev login deshabilitado de una caída temporal", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ enabled: true })))
  await expect(probeDevLogin()).resolves.toBe(false)
  await expect(probeDevLogin()).rejects.toMatchObject({ status: 503 })
  await expect(probeDevLogin()).resolves.toBe(true)
})

it("exige una redirección válida y propaga el rechazo al cerrar sesión", async () => {
  const assign = vi.fn()
  vi.stubGlobal("window", { location: { assign } })
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json({ url: "https://accounts.google.com/" }))
    .mockResolvedValueOnce(new Response(null, { status: 500 })))
  await expect(signInWithGoogle()).rejects.toMatchObject({ code: "invalid_response" })
  expect(assign).not.toHaveBeenCalled()
  await signInWithGoogle()
  expect(assign).toHaveBeenCalledWith("https://accounts.google.com/")
  await expect(signOut()).rejects.toMatchObject({ status: 500 })
})

it("maps rejected fetches and interrupted JSON bodies to network errors", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("offline")) } })))
    .mockRejectedValueOnce(new DOMException("cancelled", "AbortError")))
  await expect(probeDevLogin()).rejects.toMatchObject({ code: "network" })
  await expect(api("session")).rejects.toMatchObject({ code: "network" })
  await expect(api("session")).rejects.toMatchObject({ name: "AbortError" })
})

it("discards malformed stream data and lets subscribers handle valid events", () => {
  const listeners = new Map<string, (event: MessageEvent<string>) => void>()
  vi.stubGlobal("EventSource", class {
    addEventListener(name: string, handler: (event: MessageEvent<string>) => void) { listeners.set(name, handler) }
    close() {}
  })
  const deliver = (name: string, data: string) => listeners.get(name)!(new MessageEvent(name, { data }))
  const onEvent = vi.fn(() => { throw new Error("subscriber failed") })
  const close = subscribeLive({}, { onEvent, onStatus: vi.fn() })
  deliver("telemetry", "{")
  expect(onEvent).not.toHaveBeenCalled()
  const row = {
    id: "1", at: "2026-11-21T12:00:00Z", service: "web", kind: "http", name: "http.request", level: "info",
    traceId: null, spanId: null, parentSpanId: null, requestId: null, userId: null, agentId: null,
    durationMs: null, status: null, errorId: null, attrs: {},
  }
  expect(() => deliver("telemetry", JSON.stringify(row))).toThrow("subscriber failed")
  close()

  const onReset = vi.fn()
  const closeFlow = subscribeFlow(null, { onReset, onOpen: vi.fn(), onClosed: vi.fn(), onRetrying: vi.fn(), onRequest: vi.fn(), onRow: vi.fn() })
  deliver("reset", "{}")
  expect(onReset).not.toHaveBeenCalled()
  deliver("reset", '{"cursor":null}')
  expect(onReset).toHaveBeenCalledExactlyOnceWith(null)
  closeFlow()
})
