#!/bin/sh
# Dentro del contenedor: esquema + identidades + demo MCP con N participantes.
set -eu
n="${1:-3}"
dir="$(mktemp -d)"
node apps/server/scripts/schema.mjs
node apps/server/scripts/seed.mjs "$n" "$dir"
node apps/mcp/scripts/demo.mjs "$n" "$dir"
