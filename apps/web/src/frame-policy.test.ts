import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { expect, it } from "vitest";
import nextConfig from "../next.config";

it.each([
  ["/sign-in", "'none'"],
  ["/consent", "'none'"],
  ["/contacts", "'none'"],
  ["/embed/otra", "'none'"],
  ["/embed/flujo?autoplay=1", "*"],
])("aplica la política de enmarcado correspondiente a %s", async (path, ancestors) => {
  const response = await unstable_getResponseFromNextConfig({ url: `https://web.example${path}`, nextConfig });
  expect(response.headers.get("Content-Security-Policy")).toBe(`frame-ancestors ${ancestors}`);
});
