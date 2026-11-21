#!/usr/bin/env bash
# up.sh <cli> <titular> — emite el access token y levanta UN contenedor con UN CLI de agente que
# es UN titular de Sideband, listo para conversar.
#
#   ./infra/titular/up.sh claude caja01
#   ./infra/titular/up.sh codex  caja02     # en otra terminal
#
# Cada titular vive en su propia red Docker (`sideband-<titular>`). Dos titulares no se ven entre
# sí: el único camino entre sus agentes es el broker de Sideband. Esa incomunicación es lo que la
# prueba de punta a punta demuestra, así que la red por titular no es un detalle de comodidad.
#
# Secretos: entran por `docker run --env-file`, desde un archivo FUERA del repo que este script
# arma con umask 077 y borra al salir. Nunca `-e K=v` (queda en el historial del shell y en la
# lista de procesos), nunca horneados en la imagen, nunca impresos.

set -euo pipefail

nombre="$(basename "$0")"
log() { printf '[%s] %s\n' "${nombre}" "$*" >&2; }
morir() { log "$*"; exit 1; }

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
RAIZ="$(cd "${AQUI}/../.." && pwd -P)"

# El lazy-loader de nvm del usuario recursiona en shells no interactivos.
export PATH="/opt/homebrew/bin:${HOME}/.docker/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

IMAGEN="${TITULAR_IMAGE:-sideband-titular:latest}"

# Host del túnel Tailscale. No resuelve dentro de Docker, así que entra por --add-host.
# La URL debe quedar byte a byte igual a MCP_RESOURCE_URL: OAuth compara emisor y audiencia por
# igualdad exacta, de modo que sustituir el host por la IP rompe la autorización.
TS_HOST="${TITULAR_TS_HOST:-alfredo-martnezs-macbook-pro.tail88af94.ts.net}"
TS_IP="${TITULAR_TS_IP:-100.89.38.113}"

uso() {
  cat <<EOF >&2
Uso: ${nombre} <claude|codex|pi> <titular> [-- args extra del CLI]

El <titular> es el slug en minúsculas (caja01). El nombre del titular en Sideband sale de
TITULAR_OWNER_NAME, o del slug con la inicial en mayúscula.

Variables:
  TITULAR_OWNER_NAME  Nombre del titular en Sideband (por omisión, el slug capitalizado).
  TITULAR_IMAGE       Etiqueta de la imagen (por omisión sideband-titular:latest).
  TITULAR_FIXTURE     Fixture del titular (por omisión mock-mcp/fixtures/<titular>.json).
  TITULAR_EXTRA_ENV   Archivo extra de secretos, FUERA del repo, que pisa lo leído de .env.local.
  TITULAR_RUN_DIR     Dónde se arma el --env-file efímero (por omisión \$HOME/.config/sideband/run).
  TITULAR_RM          1 para borrar el contenedor al salir (por omisión 1).
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
command -v node   >/dev/null 2>&1 || morir "falta node"

owner_name="${TITULAR_OWNER_NAME:-$(tr '[:lower:]' '[:upper:]' <<<"${titular:0:1}")${titular:1}}"

# --- Fixture del titular ---------------------------------------------------------------------

fixture_host="${TITULAR_FIXTURE:-${AQUI}/mock-mcp/fixtures/${titular}.json}"
[[ -r "${fixture_host}" ]] || morir "no encuentro el fixture del titular: ${fixture_host} (ver TITULAR_FIXTURE)"
fixture_host="$(cd "$(dirname "${fixture_host}")" && pwd -P)/$(basename "${fixture_host}")"
fixture_cont="/opt/mock-mcp/fixtures/${titular}.json"

# --- Credenciales del modelo -------------------------------------------------------------------
# Salen del .env.local del worktree y se copian al --env-file efímero. Leer el valor aquí y no
# exportarlo evita que aparezca en la lista de procesos del contenedor.

leer_env_local() {
  local clave="$1" valor=""
  for archivo in "${RAIZ}/.env" "${RAIZ}/.env.local"; do
    [[ -r "${archivo}" ]] || continue
    local linea
    linea="$(grep -E "^${clave}=" "${archivo}" | tail -1 || true)"
    [[ -n "${linea}" ]] && valor="${linea#*=}"
  done
  # Quita comillas envolventes, igual que loadEnv de infra/sim/lib.mjs.
  valor="${valor%\"}"; valor="${valor#\"}"
  valor="${valor%\'}"; valor="${valor#\'}"
  printf '%s' "${valor}"
}

mcp_url="$(leer_env_local MCP_RESOURCE_URL)"
[[ -n "${mcp_url}" ]] || morir "no encuentro MCP_RESOURCE_URL en .env/.env.local"
[[ "${mcp_url}" == https://${TS_HOST}* ]] || morir "MCP_RESOURCE_URL (${mcp_url}) no apunta a ${TS_HOST}; el contenedor no lo alcanzaría."

case "${cli}" in
  claude|pi)
    anthropic_key="$(leer_env_local ANTHROPIC_API_KEY)"
    [[ -n "${anthropic_key}" ]] || morir "${cli} necesita ANTHROPIC_API_KEY en .env.local"
    ;;
  codex)
    ollama_base="$(leer_env_local OLLAMA_BASE_URL)"
    ollama_key="$(leer_env_local OLLAMA_API_KEY)"
    ollama_model="$(leer_env_local OLLAMA_MODEL)"
    [[ -n "${ollama_base}" && -n "${ollama_key}" ]] || morir "codex necesita OLLAMA_BASE_URL y OLLAMA_API_KEY en .env.local"
    ;;
esac

# --- Access token ------------------------------------------------------------------------------
# El alta la hace infra/titular/titular.mjs contra el stack del worktree, con la misma secuencia
# que el arnés de infra/sim. El token nunca pasa por argv ni se imprime.

log "dando de alta al titular ${owner_name} en Sideband"
alta="$(node "${AQUI}/titular.mjs" token "${owner_name}")" || morir "no pude emitir el access token de ${owner_name}"
access_token="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).accessToken)' "${alta}")"
address="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).address)' "${alta}")"
[[ -n "${access_token}" ]] || morir "el alta de ${owner_name} no devolvió access token"
log "titular ${owner_name} <${address}> · token ${access_token:0:10}…"

# --- Archivo de secretos efímero, fuera del repo -----------------------------------------------

run_dir="${TITULAR_RUN_DIR:-${HOME}/.config/sideband/run}"
case "${run_dir}" in "${RAIZ}"/*) morir "TITULAR_RUN_DIR está dentro del repo (${run_dir})." ;; esac
(umask 077; mkdir -p "${run_dir}")
env_file="${run_dir}/${cli}-${titular}.env"
trap 'rm -f "${env_file}"' EXIT

(
  umask 077
  : > "${env_file}"
  {
    printf 'TITULAR_MCP_URL=%s\n' "${mcp_url}"
    printf 'SIDEBAND_ACCESS_TOKEN=%s\n' "${access_token}"
    case "${cli}" in
      claude|pi) printf 'ANTHROPIC_API_KEY=%s\n' "${anthropic_key}" ;;
      codex)
        printf 'OLLAMA_BASE_URL=%s\n' "${ollama_base}"
        printf 'OLLAMA_API_KEY=%s\n'  "${ollama_key}"
        printf 'OLLAMA_MODEL=%s\n'    "${ollama_model:-gpt-oss:120b}"
        ;;
    esac
  } >> "${env_file}"
)

# Un archivo extra, fuera del repo, para pisar cualquiera de los anteriores sin tocar .env.local.
if [[ -n "${TITULAR_EXTRA_ENV:-}" ]]; then
  [[ -r "${TITULAR_EXTRA_ENV}" ]] || morir "no puedo leer TITULAR_EXTRA_ENV=${TITULAR_EXTRA_ENV}"
  case "$(cd "$(dirname "${TITULAR_EXTRA_ENV}")" && pwd -P)" in
    "${RAIZ}"|"${RAIZ}"/*) morir "TITULAR_EXTRA_ENV está dentro del repo. Muévelo fuera." ;;
  esac
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "${TITULAR_EXTRA_ENV}" >> "${env_file}" || true
fi

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
  run --name "${contenedor}"
  --network "${red}"
  --add-host "${TS_HOST}:${TS_IP}"
  --cap-add NET_ADMIN --cap-add NET_RAW
  --env-file "${env_file}"
  -e "TITULAR_CLI=${cli}"
  -e "TITULAR_OWNER=${owner_name}"
  -e "TITULAR_ADDRESS=${address}"
  -e "MOCK_FIXTURE=${fixture_cont}"
  -e "ANTHROPIC_MODEL=claude-haiku-4-5"
  -v "${fixture_host}:${fixture_cont}:ro"
)
# Sin TTY cuando el CLI viene con argumentos propios: así `up.sh claude caja01 -- -p "…"` sirve
# desde un script, y la sesión interactiva sigue siendo el caso por omisión.
if (( ${#extra[@]} )); then args+=(-i); else args+=(-it); fi
[[ "${TITULAR_RM:-1}" == "1" ]] && args+=(--rm)

log "titular=${owner_name} slug=${titular} cli=${cli} red=${red} imagen=${IMAGEN}"
docker "${args[@]}" "${IMAGEN}" "${cmd[@]}"
