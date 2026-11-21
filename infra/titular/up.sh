#!/usr/bin/env bash
# up.sh <cli> <titular> — levanta UN contenedor con UN CLI de agente que es UN titular Sideband.
#
#   ./infra/titular/up.sh claude ana
#   ./infra/titular/up.sh codex  bob
#
# Cada titular vive en su propia red Docker (`sideband-<titular>`). Dos titulares no se ven entre
# sí: el único camino entre sus agentes es el broker de Sideband. Esa incomunicación es lo que la
# prueba de punta a punta demuestra, así que la red por titular no es un detalle de comodidad.
#
# Secretos: entran por `docker run --env-file`, desde un archivo FUERA del repo. Nunca `-e K=v`
# (queda en el historial del shell y en la lista de procesos) y nunca horneados en la imagen.

set -euo pipefail

nombre="$(basename "$0")"
log() { printf '[%s] %s\n' "${nombre}" "$*" >&2; }
morir() { log "$*"; exit 1; }

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
RAIZ="$(cd "${AQUI}/../.." && pwd -P)"

IMAGEN="${TITULAR_IMAGE:-sideband-titular:latest}"

# Host del túnel Tailscale. No resuelve dentro de Docker, así que entra por --add-host.
# La URL debe quedar byte a byte igual a MCP_RESOURCE_URL: OAuth compara emisor y audiencia por
# igualdad exacta, de modo que sustituir el host por la IP rompe la autorización.
TS_HOST="${TITULAR_TS_HOST:-alfredo-martnezs-macbook-pro.tail88af94.ts.net}"
TS_IP="${TITULAR_TS_IP:-100.89.38.113}"

uso() {
  cat <<EOF >&2
Uso: ${nombre} <claude|codex|pi> <titular> [-- args extra del CLI]

Variables:
  TITULAR_ENV_FILE   Ruta al archivo de secretos (por omisión \$HOME/.config/sideband/titular-<titular>.env).
                     Debe estar fuera del repo. Contiene, según el CLI:
                       claude, pi : ANTHROPIC_API_KEY
                       codex      : OLLAMA_BASE_URL, OLLAMA_API_KEY, OLLAMA_MODEL
                       los tres   : SIDEBAND_ACCESS_TOKEN, TITULAR_MCP_URL
  TITULAR_IMAGE      Etiqueta de la imagen (por omisión sideband-titular:latest).
  TITULAR_FIXTURE    Fixture del titular (por omisión mock-mcp/fixtures/<titular>.json).
  TITULAR_RM         1 para borrar el contenedor al salir (por omisión 1).
EOF
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { uso; exit 0; }
(( $# >= 2 )) || { uso; morir "faltan argumentos"; }

cli="$1"; titular="$2"; shift 2
extra=()
if [[ "${1:-}" == "--" ]]; then shift; extra=("$@"); fi

case "${cli}" in claude|codex|pi) ;; *) morir "CLI inválido: ${cli} (claude, codex o pi)";; esac
[[ "${titular}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || morir "titular inválido: ${titular}"

command -v docker >/dev/null 2>&1 || morir "falta docker"

# --- Fixture del titular ---------------------------------------------------------------------

fixture_host="${TITULAR_FIXTURE:-${AQUI}/mock-mcp/fixtures/${titular}.json}"
[[ -r "${fixture_host}" ]] || morir "no encuentro el fixture del titular: ${fixture_host}"
fixture_host="$(cd "$(dirname "${fixture_host}")" && pwd -P)/$(basename "${fixture_host}")"
fixture_cont="/opt/mock-mcp/fixtures/${titular}.json"

# --- Secretos --------------------------------------------------------------------------------

env_file="${TITULAR_ENV_FILE:-${HOME}/.config/sideband/titular-${titular}.env}"
[[ -r "${env_file}" ]] || morir "no encuentro el archivo de secretos: ${env_file} (ver --help)"
env_file="$(cd "$(dirname "${env_file}")" && pwd -P)/$(basename "${env_file}")"
case "${env_file}" in
  "${RAIZ}"/*) morir "el archivo de secretos está dentro del repo (${env_file}). Muévelo fuera." ;;
esac
perm="$(stat -f '%Lp' "${env_file}" 2>/dev/null || stat -c '%a' "${env_file}")"
[[ "${perm}" == "600" || "${perm}" == "400" ]] || log "aviso: ${env_file} tiene permisos ${perm}; usa chmod 600."

# --- Red por titular ---------------------------------------------------------------------------

red="sideband-${titular}"
if ! docker network inspect "${red}" >/dev/null 2>&1; then
  log "creando la red ${red}"
  docker network create "${red}" >/dev/null
fi

contenedor="titular-${titular}-${cli}"
docker rm -f "${contenedor}" >/dev/null 2>&1 || true

# --- Arranque del CLI --------------------------------------------------------------------------
# El modelo lo fija el entrypoint (codex → Ollama Cloud) o el entorno (claude → ANTHROPIC_MODEL).
# `pi` recibe el bloque de confianza como prompt de sistema, no como archivo de contexto.

case "${cli}" in
  claude) cmd=(claude --dangerously-skip-permissions) ;;
  codex)  cmd=(codex --cd /home/agent/workspace --yolo) ;;
  pi)     cmd=(pi --model claude-haiku-4-5
                  --append-system-prompt /home/agent/.pi/system-prompt-titular.md) ;;
esac
(( ${#extra[@]} )) && cmd+=("${extra[@]}")

args=(
  run --name "${contenedor}" -it
  --network "${red}"
  --add-host "${TS_HOST}:${TS_IP}"
  --cap-add NET_ADMIN --cap-add NET_RAW
  --env-file "${env_file}"
  -e "TITULAR_CLI=${cli}"
  -e "TITULAR_OWNER=${titular}"
  -e "MOCK_FIXTURE=${fixture_cont}"
  -e "ANTHROPIC_MODEL=claude-haiku-4-5"
  -v "${fixture_host}:${fixture_cont}:ro"
)
[[ "${TITULAR_RM:-1}" == "1" ]] && args+=(--rm)

log "titular=${titular} cli=${cli} red=${red} imagen=${IMAGEN}"
exec docker "${args[@]}" "${IMAGEN}" "${cmd[@]}"
