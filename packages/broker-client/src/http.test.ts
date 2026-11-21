import { Owner } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { expect, it, vi } from "vitest";
import { createHttpClient } from "./http.js";

const owner = { userId: "alice" };
const baseUrl = "https://broker.example";

it("rejects an invalid broker URL before signing or sending", async () => {
  const getServiceToken = vi.fn<() => Promise<string>>();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const request = createHttpClient({ baseUrl: "missing-origin", getServiceToken, fetch }, Owner);

  await expect(request(routes.ownerMe, owner)).rejects.toMatchObject({ code: "internal", stage: "url" });
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

it("reports a transport failure without forwarding the underlying error or retrying the request", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("private network detail"));
  const request = createHttpClient({ baseUrl, getServiceToken: async () => "test-token", fetch }, Owner);

  const result = request(routes.ownerMe, owner);
  await expect(result).rejects.toMatchObject({ code: "internal", stage: "transport" });
  await expect(result).rejects.not.toThrow("private network detail");
  expect(fetch).toHaveBeenCalledOnce();
});
