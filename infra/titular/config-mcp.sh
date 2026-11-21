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
# En los tres CLI el token queda **por referencia al entorno** (`${SIDEBAND_ACCESS_TOKEN}` o el
# nombre de la variable), nunca como valor en disco. Las recetas están verificadas contra el MCP
# real en docs/agents/mcp-token-por-cli.md.
#
# TITULAR_MCP_URL debe ser byte a byte igual a MCP_RESOURCE_URL del servidor: OAuth compara
# emisor y audiencia por igualdad exacta. Nunca sustituyas el host por una IP; el acceso por IP
# lo resuelve `--add-host` en up.sh.

set -euo pipefail

MOCK_DIR="/opt/mock-mcp"

configurar_mcp() {
  local cli="$1" home="$2" fixture="$3"
  local url="${TITULAR_MCP_URL:-}"

  if [[ -z "${url}" ]]; then
    echo "[config-mcp] falta TITULAR_MCP_URL; el CLI quedaría sin Sideband." >&2
    return 1
  fi
  if [[ -z "${SIDEBAND_ACCESS_TOKEN:-}" ]]; then
    echo "[config-mcp] falta SIDEBAND_ACCESS_TOKEN; el MCP remoto responderá 401." >&2
    return 1
  fi

  case "${cli}" in
    claude) _mcp_claude "${home}" "${fixture}" "${url}" ;;
    codex)  _mcp_codex  "${home}" "${fixture}" "${url}" ;;
    pi)     _mcp_pi     "${home}" "${fixture}" "${url}" ;;
    *) echo "[config-mcp] CLI desconocido: ${cli}" >&2; return 1 ;;
  esac
}

# Corre un comando como el usuario del contenedor con el HOME del titular. CLAUDE_CONFIG_DIR va
# fijado a mano: `claude mcp add` ignora HOME cuando esa variable existe, así que dejarla al azar
# del entorno heredado significa escribir la configuración en un directorio que el CLI no leerá.
como_titular() {
  local home="$1"; shift
  gosu "${CONTAINER_USER:-agent}" env HOME="${home}" CLAUDE_CONFIG_DIR="${home}" "$@"
}

# --- claude ----------------------------------------------------------------------------------
# `claude mcp add --scope user` escribe $CLAUDE_CONFIG_DIR/.claude.json.
#
# El valor de `--header` se expande desde el entorno al conectar, así que el archivo guarda la
# cadena literal `Bearer ${SIDEBAND_ACCESS_TOKEN}` y no el token. Las comillas simples son
# obligatorias: con dobles, bash lo expandiría aquí y hornearía el valor en el disco.
_mcp_claude() {
  local home="$1" fixture="$2" url="$3"
  como_titular "${home}" claude mcp add titular --scope user \
      --env "MOCK_FIXTURE=${fixture}" \
      -- node "${MOCK_DIR}/mock-mcp.mjs" >&2

  como_titular "${home}" claude mcp add sideband --scope user --transport http \
      "${url}" \
      --header 'Authorization: Bearer ${SIDEBAND_ACCESS_TOKEN}' >&2
}

# --- codex -----------------------------------------------------------------------------------
# `codex mcp add` escribe $CODEX_HOME/config.toml (aquí, $HOME/.codex/config.toml), agregando
# tablas `[mcp_servers.*]` al final. El entrypoint ya dejó ahí las claves sueltas del modelo:
# en TOML tienen que ir antes de cualquier tabla, y por eso este paso va después.
#
# `--bearer-token-env-var` guarda el NOMBRE de la variable, nunca el valor.
#
# `< /dev/null` no es cosmético: sin él codex se queda esperando en stdin y el entrypoint cuelga.
_mcp_codex() {
  local home="$1" fixture="$2" url="$3"
  mkdir -p "${home}/.codex"
  chown "${CONTAINER_USER:-agent}:${CONTAINER_USER:-agent}" "${home}/.codex"
  como_titular "${home}" codex mcp add titular \
      --env "MOCK_FIXTURE=${fixture}" \
      -- node "${MOCK_DIR}/mock-mcp.mjs" < /dev/null >&2

  como_titular "${home}" codex mcp add sideband \
      --url "${url}" \
      --bearer-token-env-var SIDEBAND_ACCESS_TOKEN < /dev/null >&2
}

# --- pi --------------------------------------------------------------------------------------
# `pi mcp add` escribe $HOME/.pi/agent/mcp.json. Misma forma que codex: el archivo guarda el
# nombre de la variable, el token sólo vive en el entorno del proceso.
_mcp_pi() {
  local home="$1" fixture="$2" url="$3"
  como_titular "${home}" pi mcp add titular \
      --env "MOCK_FIXTURE=${fixture}" -- node "${MOCK_DIR}/mock-mcp.mjs" >&2

  como_titular "${home}" pi mcp add sideband \
      --url "${url}" --bearer-token-env-var SIDEBAND_ACCESS_TOKEN >&2
}
