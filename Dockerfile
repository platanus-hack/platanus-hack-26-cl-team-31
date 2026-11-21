# syntax=docker/dockerfile:1
# Imagen del stack de coordinación: API (apps/server), adaptador MCP stdio, demo, tests y carga (apps/scale).
# `turbo prune` recorta el monorepo a esos paquetes; las capas de dependencias sólo se rehacen
# cuando cambian los package.json o el lockfile, y el build reutiliza la caché de turbo.
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true TURBO_TELEMETRY_DISABLED=1 TURBO_UI=false
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate \
 && npm install -g turbo@2.11.13 --no-fund --no-audit
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune @team-31/server @team-31/scale @team-31/mcp --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline

FROM deps AS app
COPY --from=pruner /app/out/full/ .
# Archivos de la raíz que usan la demo y el seed (fuera de los paquetes podados).
COPY scripts ./scripts
COPY infra/docker ./infra/docker
RUN --mount=type=cache,id=turbo-cache,target=/app/.turbo/cache \
    turbo run build --filter=@team-31/server --cache-dir=/app/.turbo/cache
EXPOSE 4310
CMD ["node", "apps/server/dist/index.js"]
