// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { Wizard } from "./Wizard";

vi.mock("../connections", () => ({ listConnections: async () => [] }));
vi.mock("../../../owner", () => ({ requireAddress: vi.fn() }));
vi.mock("../actions", () => ({ selectConnection: vi.fn() }));
vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

it("genera para OpenClaw la entrada MCP de Sideband con la URL configurada y OAuth", async () => {
  const url = "https://sideband.example.test/equipo/mcp";
  vi.stubEnv("MCP_RESOURCE_URL", url);
  const view = document.createElement("div");
  view.innerHTML = renderToStaticMarkup(await Wizard({ kind: "openclaw", agentId: undefined, install: null }));

  const copy = view.querySelector('button[aria-label="Copiar Configuración MCP para openclaw.json"]');
  const snippet = copy?.closest("figure")?.querySelector('[role="region"]')?.textContent;
  expect(snippet).toBeTruthy();
  expect(JSON.parse(snippet!)).toMatchObject({
    mcp: { servers: { sideband: { url, transport: "streamable-http", auth: "oauth" } } },
  });
});
