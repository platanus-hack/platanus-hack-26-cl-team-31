#!/bin/bash
# config-mcp.sh — una función por CLI para dejarle sus dos servidores MCP:
#
#   titular  — stdio, el mock-mcp de /opt/mock-mcp con el fixture del titular.
#   sideband — HTTP remoto, el MCP de Sideband por el túnel Tailscale, con el access token.
#
# Corre DENTRO del contenedor, invocado por el entrypoint. Es deliberado: así el token sale del
# `--env-file` directo al archivo de configuración del contenedor, sin pasar nunca por el disco
# del host, por `-e KEY=value` ni por la lista de procesos.
#
# TITULAR_MCP_URL debe ser byte a byte igual a MCP_RESOURCE_URL del servidor: OAuth compara
# emisor y audiencia por igualdad exacta. Nunca sustituyas el host por una IP; el acceso por IP
# lo resuelve `--add-host` en up.sh.

set -euo pipefail

MOCK_DIR="/opt/mock-mcp"

configurar_mcp() {
  local cli="$1" home="$2" fixture="$3"
  local url="${TITULAR_MCP_URL:-}"
  local token="${SIDEBAND_ACCESS_TOKEN:-}"

  case "${cli}" in
    claude) _mcp_claude "${home}" "${fixture}" "${url}" "${token}" ;;
    codex)  _mcp_codex  "${home}" "${fixture}" "${url}" "${token}" ;;
    pi)     _mcp_pi     "${home}" "${fixture}" "${url}" "${token}" ;;
    *) echo "[config-mcp] CLI desconocido: ${cli}" >&2; return 1 ;;
  esac
}

# --- claude ----------------------------------------------------------------------------------
# El servidor stdio se registra con `claude mcp add --scope user`, que escribe ~/.claude.json.
#
# TODO(sideband): la forma exacta del transporte HTTP con el access token la está fijando
# docs/agents/mcp-token-por-cli.md. Hasta que ese documento exista y se verifique contra el CLI
# instalado, esta función NO registra el servidor remoto: prefiero que falte a que mienta.
_mcp_claude() {
  local home="$1" fixture="$2" url="$3" token="$4"
  gosu "${CONTAINER_USER:-agent}" env HOME="${home}" \
    claude mcp add titular --scope user \
      --env "MOCK_FIXTURE=${fixture}" \
      -- node "${MOCK_DIR}/mock-mcp.mjs" >&2

  if [[ -n "${url}" && -n "${token}" ]]; then
    echo "[config-mcp] claude: servidor 'sideband' NO registrado (ver TODO en config-mcp.sh)." >&2
  fi
}

# --- codex -----------------------------------------------------------------------------------
# `codex mcp add` escribe ~/.codex/config.toml.
#
# TODO(sideband): mismo caso que claude. Pendiente de docs/agents/mcp-token-por-cli.md.
_mcp_codex() {
  local home="$1" fixture="$2" url="$3" token="$4"
  mkdir -p "${home}/.codex"
  chown "${CONTAINER_USER:-agent}:${CONTAINER_USER:-agent}" "${home}/.codex"
  gosu "${CONTAINER_USER:-agent}" env HOME="${home}" \
    codex mcp add titular \
      --env "MOCK_FIXTURE=${fixture}" \
      -- node "${MOCK_DIR}/mock-mcp.mjs" >&2

  if [[ -n "${url}" && -n "${token}" ]]; then
    echo "[config-mcp] codex: servidor 'sideband' NO registrado (ver TODO en config-mcp.sh)." >&2
  fi
}

# --- pi --------------------------------------------------------------------------------------
# Verificado contra pi 1.4.0: `pi mcp add` escribe ~/.pi/agent/mcp.json.
#
# `--bearer-token-env-var` guarda la referencia "Bearer ${SIDEBAND_ACCESS_TOKEN}" en el archivo,
# no el valor: el token sólo vive en el entorno del proceso. Es la forma que preferimos; cuando
# docs/agents/mcp-token-por-cli.md aterrice, confirma que coincide.
_mcp_pi() {
  local home="$1" fixture="$2" url="$3" token="$4"
  gosu "${CONTAINER_USER:-agent}" env HOME="${home}" \
    pi mcp add titular --env "MOCK_FIXTURE=${fixture}" -- node "${MOCK_DIR}/mock-mcp.mjs" >&2

  if [[ -n "${url}" ]]; then
    gosu "${CONTAINER_USER:-agent}" env HOME="${home}" \
      pi mcp add sideband --url "${url}" --bearer-token-env-var SIDEBAND_ACCESS_TOKEN >&2
  else
    echo "[config-mcp] pi: falta TITULAR_MCP_URL; no registro 'sideband'." >&2
  fi
}
