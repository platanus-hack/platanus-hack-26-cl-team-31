# syntax=docker/dockerfile:1
# Imagen única para la API de coordinación, el adaptador MCP, la demo y los tests.
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true TURBO_TELEMETRY_DISABLED=1 TURBO_UI=false
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate
WORKDIR /app

# Descarga dependencias sólo cuando cambia el lockfile.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

FROM deps AS app
COPY . .
# La web (Next.js) no participa de la coordinación: se omite para mantener la imagen liviana.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter '!@team-31/web'
RUN pnpm turbo run build \
      --filter=@team-31/server --filter=@team-31/mcp \
      --filter=@team-31/protocol --filter=@team-31/broker
EXPOSE 4310
CMD ["node", "apps/server/dist/index.js"]
