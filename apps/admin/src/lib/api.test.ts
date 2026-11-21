import { afterEach, expect, it, vi } from "vitest"
import { api, probeDevLogin, signInWithGoogle, signOut } from "./api"

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
