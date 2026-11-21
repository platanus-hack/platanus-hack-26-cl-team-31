#!/usr/bin/env bash
# Levanta o reinicia los servicios del worktree sin dejar un proceso viejo sirviendo un build
# obsoleto. Esa falla costó cuatro diagnósticos equivocados en una sola sesión: el síntoma
# aparece en otro lado (un 500, un arreglo "que no tomó", un 409) y se investiga lo que no es.
#
#   scripts/stack.sh up [web|mcp|broker|all]
#   scripts/stack.sh restart web
#   scripts/stack.sh down [web|mcp|broker|all]
#   scripts/stack.sh status
#
# web corre en modo desarrollo a propósito: SIDEBAND_DEV_AUTH se niega a arrancar con
# NODE_ENV=production, y `next start` lo fuerza. El MCP sí queda en producción, así que la
# exigencia de https se sigue aplicando donde importa.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# El lazy-loader de nvm del usuario recursiona en shells no interactivos.
# /usr/sbin es obligatorio: ahí vive lsof en macOS.
export PATH="/opt/homebrew/bin:$HOME/.docker/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

command -v lsof >/dev/null || { echo "Falta lsof: sin él no se puede saber si un puerto está libre." >&2; exit 1; }

[ -f .env ] || { echo "Falta .env — corre: pnpm bootstrap" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; [ -f .env.local ] && . ./.env.local; set +a

LOGS="${TMPDIR:-/tmp}/sideband-$SLOT"
mkdir -p "$LOGS"

port_of() { case "$1" in web) echo "$WEB_PORT";; mcp) echo "$MCP_PORT";; broker) echo "$BROKER_PORT";; esac; }

# Devuelve los PID que escuchan en el puerto. lsof sale 1 cuando no hay ninguno, que es el caso
# normal; cualquier otro código es un fallo de la herramienta y se reporta, porque un verificador
# que contesta "libre" cuando en realidad no pudo mirar haría arrancar un segundo proceso encima.
holders() {
  local out rc
  out="$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null)" && rc=0 || rc=$?
  if [ "$rc" -gt 1 ]; then echo "lsof falló con código $rc al mirar :$1" >&2; return "$rc"; fi
  printf '%s' "$out"
}

# Mata y NO vuelve hasta confirmar que el puerto quedó libre. Si sigue ocupado, falla ruidosamente
# en vez de arrancar un segundo proceso que no podrá escuchar y morirá con EADDRINUSE en silencio.
free_port() {
  local port="$1" pids
  pids="$(holders "$port")"
  [ -z "$pids" ] && return 0
  echo "  · matando $(echo "$pids" | tr '\n' ' ')en :$port"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 20); do [ -z "$(holders "$port")" ] && return 0; sleep 0.5; done
  pids="$(holders "$port")"
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  for _ in $(seq 1 10); do [ -z "$(holders "$port")" ] && return 0; sleep 0.5; done
  echo "  ✗ :$port sigue ocupado por $(holders "$port" | tr '\n' ' ')" >&2
  return 1
}

wait_listen() {
  local port="$1" name="$2"
  for _ in $(seq 1 120); do
    [ -n "$(holders "$port")" ] && { echo "  ✓ $name escuchando en :$port"; return 0; }
    sleep 1
  done
  echo "  ✗ $name no llegó a escuchar en :$port — revisa $LOGS/$name.log" >&2
  tail -15 "$LOGS/$name.log" >&2 2>/dev/null || true
  return 1
}

start_one() {
  local name="$1" port; port="$(port_of "$name")"
  free_port "$port"
  case "$name" in
    web)    nohup pnpm with-env env SIDEBAND_DEV_AUTH=1 NODE_ENV=development \
              pnpm --filter @team-31/web exec next dev -p "$port" -H 127.0.0.1 >"$LOGS/web.log" 2>&1 & ;;
    mcp)    nohup pnpm with-env env NODE_ENV=production \
              pnpm --filter @team-31/mcp dev >"$LOGS/mcp.log" 2>&1 & ;;
    broker) nohup pnpm with-env env WAKE_ALLOW_INSECURE=1 \
              pnpm --filter @team-31/broker-service dev >"$LOGS/broker.log" 2>&1 & ;;
  esac
  wait_listen "$port" "$name"
}

targets() { case "${1:-all}" in all) echo "broker mcp web";; *) echo "$1";; esac; }

case "${1:-status}" in
  up|restart) for s in $(targets "${2:-all}"); do echo "$s:"; start_one "$s"; done ;;
  down)       for s in $(targets "${2:-all}"); do echo "$s:"; free_port "$(port_of "$s")"; done ;;
  status)
    for s in broker mcp web; do
      p="$(port_of "$s")"; h="$(holders "$p")"
      if [ -n "$h" ]; then printf "%-7s :%-6s arriba (%s)\n" "$s" "$p" "$(echo "$h" | tr '\n' ' ' | sed 's/ $//')"
      else printf "%-7s :%-6s abajo\n" "$s" "$p"; fi
    done ;;
  *) sed -n '3,9p' "$0"; exit 1 ;;
esac
