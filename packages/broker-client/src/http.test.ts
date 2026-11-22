import { Owner } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { expect, it, vi } from "vitest";
import { BrokerError } from "./errors.js";
import { createHttpClient } from "./http.js";

const owner = { userId: "alice" };
const baseUrl = "https://broker.example";

it("rejects an invalid broker URL before signing or sending", async () => {
  const getServiceToken = vi.fn<() => Promise<string>>();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const request = createHttpClient({ baseUrl: "missing-origin", getServiceToken, fetch }, Owner);

  await expect(request(routes.ownerMe, owner)).rejects.toMatchObject({
    code: "internal", stage: "url", cause: expect.any(TypeError),
  });
  expect(getServiceToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("releases an unavailable response and shares one deadline across both signed attempts", async () => {
  const cancel = vi.fn();
  const unavailable = new Response(new ReadableStream({ cancel }), { status: 503 });
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(unavailable)
    .mockImplementationOnce(async () => {
      expect(cancel).toHaveBeenCalledOnce();
      return Response.json(owner);
    });
  const request = createHttpClient({ baseUrl, getServiceToken: async () => "test-token", fetch }, Owner);

  await expect(request(routes.ownerMe, owner)).resolves.toEqual(owner);
  expect(fetch).toHaveBeenCalledTimes(2);
  const [first, second] = fetch.mock.calls.map(([, options]) => options);
  expect(first?.signal).toBeInstanceOf(AbortSignal);
  expect(second?.signal).toBe(first?.signal);
  for (const options of [first, second]) {
    expect(options).toMatchObject({ cache: "no-store", redirect: "error" });
  }
});

it("keeps the original transport failure local and sends the request once", async () => {
  const cause = Object.assign(new Error("private network detail"), { detail: "private network detail" });
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(cause);
  const request = createHttpClient({ baseUrl, getServiceToken: async () => "test-token", fetch }, Owner);

  const result = request(routes.ownerMe, owner);
  await expect(result).rejects.toMatchObject({ code: "internal", stage: "transport" });
  await expect(result).rejects.toSatisfy((error: BrokerError) => error.cause === cause);
  await expect(result).rejects.not.toThrow(cause.message);
  await expect(result).rejects.toSatisfy((error: BrokerError) => !JSON.stringify(error).includes(cause.message));
  expect(fetch).toHaveBeenCalledOnce();
});

it("keeps distinct causes for aborted and malformed response bodies with the same public message", async () => {
  const abort = new DOMException("private stream detail", "AbortError");
  const stream = new ReadableStream({ start(controller) { controller.error(abort); } });
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(stream))
    .mockResolvedValueOnce(new Response("private invalid JSON"));
  const request = createHttpClient({ baseUrl, getServiceToken: async () => "test-token", fetch }, Owner);
  const publicError = { code: "internal", stage: "decoding", message: "No se pudo completar la llamada al broker." };

  const aborted = request(routes.ownerMe, owner);
  await expect(aborted).rejects.toMatchObject(publicError);
  await expect(aborted).rejects.toSatisfy((error: BrokerError) => error.cause === abort);
  await expect(request(routes.ownerMe, owner)).rejects.toMatchObject({ ...publicError, cause: expect.any(SyntaxError) });
});
