import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/rules", destination: "/grants", permanent: true }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingExcludes: {
    "/api/demo": ["../../.agents-local/**/*"],
    "/api/demo/contact-wake/*": ["../../.agents-local/**/*"],
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
