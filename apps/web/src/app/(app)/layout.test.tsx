// @vitest-environment happy-dom
import { renderToReadableStream } from "react-dom/server";
import { expect, it, vi } from "vitest";

import ActivityPage from "./activity/page";
import { readActivity } from "./activity/read-activity";
import AppLayout from "./layout";

const { getOwnerAccount } = vi.hoisted(() => ({ getOwnerAccount: vi.fn() }));
vi.mock("@/lib/auth-owner", () => ({ getOwnerAccount }));
vi.mock("./account-menu", () => ({ AccountMenu: () => null }));
vi.mock("./activity/read-activity", () => ({ readActivity: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/activity" }));

it("empieza a leer la actividad mientras espera la cuenta del titular", async () => {
  const account = Promise.withResolvers<{ user: { name: string } }>();
  getOwnerAccount.mockReturnValue(account.promise);
  vi.mocked(readActivity).mockResolvedValue({ page: 2, items: [], hasNext: false });

  const stream = await renderToReadableStream(
    <AppLayout>
      <ActivityPage params={Promise.resolve({})} searchParams={Promise.resolve({ page: "2" })} />
    </AppLayout>,
  );
  try {
    expect(getOwnerAccount).toHaveBeenCalled();
    expect(readActivity).toHaveBeenCalledWith("2");
  } finally {
    account.resolve({ user: { name: "Ana" } });
    await stream.allReady;
    await stream.cancel();
  }
});
