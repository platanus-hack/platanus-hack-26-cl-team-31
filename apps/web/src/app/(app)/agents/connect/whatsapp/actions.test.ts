import { beforeEach, expect, it, vi } from "vitest";

import { updatePhone } from "./actions";

const { start } = vi.hoisted(() => ({ start: vi.fn<(userId: string) => Promise<string | undefined>>() }));
vi.mock("@/lib/whatsapp/runtime", () => ({ whatsappStore: () => ({ start }) }));
vi.mock("@/lib/whatsapp/kapso", () => ({ config: () => ({ number: "+56911112222" }) }));
vi.mock("@/lib/whatsapp/channel", () => ({ setChannel: vi.fn() }));
vi.mock("@/lib/telemetry", () => ({ getTelemetry: () => ({ emit: vi.fn(), error: vi.fn() }) }));
vi.mock("../../../owner", () => ({ getOwner: async () => ({ userId: "ana" }), requireAddress: async () => "ana@sideband.app" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const code = "0123456789abcdef0123456789abcdef";

beforeEach(() => start.mockReset());

it("returns the WhatsApp link and its QR so the code can be sent from another device", async () => {
  start.mockResolvedValue(code);
  const form = new FormData();
  form.set("action", "start");

  const result = await updatePhone({}, form);

  expect(result).toMatchObject({ code, link: `https://wa.me/56911112222?text=VINCULAR%20${code}` });
  expect(result.qr).toMatch(/^data:image\/png;base64,/);
});
