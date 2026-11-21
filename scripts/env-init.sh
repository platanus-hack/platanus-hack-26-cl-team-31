#!/usr/bin/env bash
# Genera el .env de este worktree con un SLOT único -> puertos y stack docker aislados.
# Idempotente: si .env ya tiene SLOT, lo reutiliza.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
REGISTRY="$(git rev-parse --path-format=absolute --git-common-dir)/team31-slots"
ENV_FILE="$ROOT/.env"
touch "$REGISTRY"

# Limpia entradas de worktrees que ya no existen.
tmp="$(mktemp)"
while read -r s p; do [ -n "${p:-}" ] && [ -d "$p" ] && [ "$p" != "$ROOT" ] && echo "$s $p"; done <"$REGISTRY" >"$tmp" || true
mv "$tmp" "$REGISTRY"

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

SLOT=""
[ -f "$ENV_FILE" ] && SLOT="$(sed -n 's/^SLOT=//p' "$ENV_FILE" | head -1)"
if [ -z "$SLOT" ]; then
  for s in $(seq 0 49); do
    grep -q "^$s " "$REGISTRY" && continue
    port_busy $((3000 + s)) && continue
    port_busy $((54320 + s)) && continue
    port_busy $((4310 + s)) && continue
    SLOT=$s; break
  done
  [ -z "$SLOT" ] && { echo "No hay slots libres" >&2; exit 1; }
fi
echo "$SLOT $ROOT" >>"$REGISTRY"

# --- Puertos: BASE + SLOT. Al agregar un servicio, agrega su variable aquí. ---
WEB_PORT=$((3000 + SLOT))
POSTGRES_PORT=$((54320 + SLOT))
COORDINATION_PORT=$((4310 + SLOT))

cat >"$ENV_FILE" <<ENV
# GENERADO por scripts/env-init.sh — no editar a mano (secretos van en .env.local)
SLOT=$SLOT
COMPOSE_PROJECT_NAME=team31-$SLOT

WEB_PORT=$WEB_PORT
BETTER_AUTH_URL=http://127.0.0.1:$WEB_PORT
POSTGRES_PORT=$POSTGRES_PORT
COORDINATION_PORT=$COORDINATION_PORT
COORDINATION_API_URL=http://127.0.0.1:$COORDINATION_PORT

DATABASE_URL=postgresql://postgres:postgres@localhost:$POSTGRES_PORT/app
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:$POSTGRES_PORT/app_test
ENV

[ -f "$ROOT/.env.local" ] || cp "$ROOT/.env.local.example" "$ROOT/.env.local"
echo "✔ .env listo (slot $SLOT): web :$WEB_PORT · postgres :$POSTGRES_PORT"
