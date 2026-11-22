import { BrokerError } from "@team-31/broker-client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { claimAddress } from "../app/(app)/onboarding/actions";
import OnboardingPage from "../app/(app)/onboarding/page";
import InvitePage from "../app/(auth)/invite/page";
import CompleteSignIn from "../app/(auth)/sign-in/complete/page";
import SignInPage from "../app/(auth)/sign-in/page";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAddress: vi.fn(),
  getOAuthRequest: vi.fn(),
  claimAddress: vi.fn(),
  googleButton: vi.fn(),
  devLoginForm: vi.fn(),
  devAuth: vi.fn(),
  addressForm: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(path); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession, getAuth: () => ({ options: { socialProviders: { google: {} } } }) }));
vi.mock("@/lib/auth-env.mjs", () => ({ getDevAuth: () => mocks.devAuth() }));
vi.mock("@/lib/auth-owner", () => ({ getOwnerAddress: mocks.getAddress }));
vi.mock("@/lib/auth-request", () => ({ getOAuthRequest: mocks.getOAuthRequest }));
vi.mock("@/lib/broker", () => ({ ownerClient: () => ({ claimAddress: mocks.claimAddress }) }));
vi.mock("@/lib/onboarding-flow", () => import("./onboarding-flow"));
vi.mock("@/lib/telemetry", () => ({
  observeWebRequest: (_method: string, _route: string, run: (span: { setErrorId: () => void }) => unknown) =>
    run({ setErrorId: vi.fn() }),
  getTelemetry: () => ({ identify: vi.fn(), emit: vi.fn(), error: () => "error-id" }),
}));
vi.mock("../app/(app)/owner", () => ({
  getAddress: mocks.getAddress,
  getOwner: () => ({ userId: "recipient" }),
}));
vi.mock("../app/(app)/onboarding/form", () => ({
  AddressForm: (props: object) => { mocks.addressForm(props); return null; },
}));
vi.mock("../app/(auth)/sign-in/google-button", () => ({
  GoogleButton: (props: object) => { mocks.googleButton(props); return null; },
}));
vi.mock("../app/(auth)/sign-in/dev-login-form", () => ({
  DevLoginForm: (props: object) => { mocks.devLoginForm(props); return null; },
}));

function pageProps(searchParams: Record<string, string | string[] | undefined>) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
}

const invitation = () => pageProps({ from: "invite" });

beforeEach(() => vi.resetAllMocks());

describe("registrarse desde una invitación", () => {
  it("muestra una bienvenida pública con el enlace a iniciar sesión", async () => {
    expect(renderToStaticMarkup(await InvitePage())).toContain('href="/sign-in?from=invite"');
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("conserva el destino después de Google y al reintentar un error de autenticación", async () => {
    const page = await SignInPage(pageProps({ from: "invite", error: "access_denied" }));
    expect(renderToStaticMarkup(page)).toContain("Intenta de nuevo");
    expect(mocks.googleButton).toHaveBeenCalledWith({
      callbackURL: "/sign-in/complete?from=invite",
      errorCallbackURL: "/sign-in?from=invite",
    });
  });

  it("omite el alta cuando el titular ya tiene sesión y dirección", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "recipient" } });
    mocks.getAddress.mockResolvedValue("destinatario@sideband.app");

    await expect(SignInPage(invitation())).rejects.toThrow("/sign-in/complete?from=invite");
    await expect(CompleteSignIn(invitation())).rejects.toThrow("/agents/connect");
  });

  it("conserva el destino al elegir una dirección, incluso si el primer nombre está tomado", async () => {
    await expect(CompleteSignIn(invitation())).rejects.toThrow("/onboarding?from=invite");
    renderToStaticMarkup(await OnboardingPage(invitation()));
    expect(mocks.addressForm).toHaveBeenCalledWith({ source: "invite" });

    const form = new FormData();
    form.set("localPart", "tomada");
    mocks.claimAddress.mockRejectedValueOnce(new BrokerError("conflict", "Dirección ocupada"));
    const feedback = await claimAddress("invite", {}, form);
    expect(feedback).toEqual({ error: "Esa dirección ya está tomada", errorId: "error-id" });

    form.set("localPart", "destinatario");
    await expect(claimAddress("invite", feedback, form)).rejects.toThrow("/agents/connect");
    expect(mocks.claimAddress).toHaveBeenLastCalledWith({ userId: "recipient" }, "destinatario");
  });

  it.each([undefined, ["invite"], "https://example.test"])(
    "conserva el acceso normal cuando el origen es %j",
    async (from) => {
      mocks.getAddress.mockResolvedValue("titular@sideband.app");
      await expect(CompleteSignIn(pageProps({ from }))).rejects.toThrow(/^\/$/);
    },
  );

  it("conserva las rutas del consentimiento OAuth firmado", async () => {
    const signedQuery = "client_id=agente&sig=firma";
    mocks.getOAuthRequest.mockResolvedValue({ signedQuery });

    renderToStaticMarkup(await SignInPage(pageProps({ client_id: "agente", sig: "firma", error: "access_denied" })));

    expect(mocks.getOAuthRequest).toHaveBeenCalledWith({ client_id: "agente", sig: "firma" });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.googleButton).toHaveBeenCalledWith({
      callbackURL: "/sign-in/complete",
      errorCallbackURL: `/sign-in?${signedQuery}`,
    });
    expect(mocks.devLoginForm).not.toHaveBeenCalled();
  });

  it("ofrece el login de desarrollo sin saltarse el consentimiento", async () => {
    const signedQuery = "client_id=agente&sig=firma";
    mocks.devAuth.mockReturnValue(true);
    mocks.getOAuthRequest.mockResolvedValue({ signedQuery, scopes: [] });

    renderToStaticMarkup(await SignInPage(pageProps({ client_id: "agente", sig: "firma" })));
    expect(mocks.devLoginForm).toHaveBeenCalledWith({ next: `/consent?${signedQuery}` });

    renderToStaticMarkup(await SignInPage(invitation()));
    expect(mocks.devLoginForm).toHaveBeenLastCalledWith({ next: "/sign-in/complete?from=invite" });
  });
});
