import { beforeEach, expect, it, vi } from "vitest";

import { updatePhone } from "./actions";

const { start, unlink, setChannel, requireAddress } = vi.hoisted(() => ({
  start: vi.fn<(userId: string) => Promise<string | undefined>>(),
  unlink: vi.fn(async (_userId: string, disconnect: () => Promise<unknown>) => { await disconnect(); }),
  setChannel: vi.fn(),
  requireAddress: vi.fn(),
}));
vi.mock("@/lib/whatsapp/runtime", () => ({ whatsappStore: () => ({ start, unlink }) }));
vi.mock("@/lib/whatsapp/kapso", () => ({ config: () => ({ number: "+56911112222" }) }));
vi.mock("@/lib/whatsapp/channel", () => ({ setChannel }));
vi.mock("@/lib/telemetry", () => ({ getTelemetry: () => ({ emit: vi.fn(), error: vi.fn() }) }));
vi.mock("../../../owner", () => ({ getOwner: async () => ({ userId: "ana" }), requireAddress }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const code = "0123456789abcdef0123456789abcdef";

beforeEach(() => {
  vi.clearAllMocks();
  requireAddress.mockResolvedValue("ana@sideband.app");
});

it("returns the WhatsApp link and its QR so the code can be sent from another device", async () => {
  start.mockResolvedValue(code);
  const form = new FormData();
  form.set("action", "start");

  const result = await updatePhone({}, form);

  expect(requireAddress).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ code, link: `https://wa.me/56911112222?text=VINCULAR%20${code}` });
  expect(result.qr).toMatch(/^data:image\/png;base64,/);
});

it("desvincula el teléfono desde el formulario aunque el broker esté caído", async () => {
  const offline = new Error("broker offline");
  requireAddress.mockRejectedValue(offline);
  setChannel.mockResolvedValueOnce(false);
  const form = new FormData();
  form.set("action", "unlink");

  expect(await updatePhone({}, form)).toEqual({ message: "WhatsApp desvinculado." });

  expect(unlink).toHaveBeenCalledExactlyOnceWith("ana", expect.any(Function));
  expect(setChannel).toHaveBeenCalledExactlyOnceWith("ana", { kind: "none" });
});
