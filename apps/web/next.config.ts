import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Solo /embed/* se puede enmarcar desde otro origen (presentaciones con iframe). No hay otra cabecera
  // de enmarcado en la app, así que el resto conserva el comportamiento por defecto.
  async headers() {
    return [{ source: "/embed/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] }];
  },
  async redirects() {
    return ["/rules", "/grants", "/friends"].map((source) => ({ source, destination: "/contacts", permanent: false }));
  },
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingExcludes: {
    "/api/demo": ["../../.agents-local/**/*"],
    "/api/demo/contact-wake/*": ["../../.agents-local/**/*"],
  },
  async rewrites() {
    if (process.env.RENDER !== "true") return [];
    const port = Number(process.env.MCP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("MCP_PORT no es válido.");
    }
    return [
      "/mcp",
      "/healthz",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ].map((path) => ({ source: path, destination: `http://127.0.0.1:${port}${path}` }));
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
