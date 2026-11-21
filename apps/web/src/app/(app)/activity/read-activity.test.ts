import { afterEach, expect, it, vi } from "vitest";
import { readActivity } from "./read-activity";

const { activity } = vi.hoisted(() => ({ activity: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/broker", () => ({ ownerClient: () => ({ activity }) }));
vi.mock("../owner", () => ({
  readAsOwner: async (read: (owner: { userId: string }) => Promise<unknown>) => ({ data: await read({ userId: "ana" }) }),
}));
afterEach(() => vi.resetAllMocks());

it.each([undefined, "", "-1", "2.5", ["2"], String(Number.MAX_SAFE_INTEGER)])("falls back to the first page for %j", async (page) => {
  activity.mockResolvedValue([]);
  expect(await readActivity(page)).toEqual({ page: 1, items: [], hasNext: false });
  expect(activity).toHaveBeenCalledWith({ userId: "ana" }, 21);
});

it("uses the lookahead item only to decide whether to show the next page", async () => {
  const items = Array.from({ length: 41 }, (_, index) => ({ requestId: String(index) }));
  activity.mockResolvedValueOnce(items).mockResolvedValueOnce(items.slice(0, 40));
  const result = { page: 2, items: items.slice(20, 40) };
  expect(await readActivity("2")).toEqual({ ...result, hasNext: true });
  expect(await readActivity("2")).toEqual({ ...result, hasNext: false });
  expect(activity).toHaveBeenCalledWith({ userId: "ana" }, 41);
});
