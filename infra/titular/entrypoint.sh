#!/bin/bash
# entrypoint.sh — cortafuegos de egreso + configuración del titular antes de ejecutar el CLI.
#
# Derivado del entrypoint de ~/my-github/os/ai-containers. Conserva el bloque de ipset/iptables
# y quita todo lo de GitHub/SSH/git, que un titular no usa. Suma dos cosas:
#   - resuelve los dominios permitidos con getent, para que /etc/hosts (--add-host del túnel
#     Tailscale, que no tiene DNS dentro de Docker) cuente como resolución válida;
#   - arma el bloque de confianza y la configuración MCP del CLI elegido.

set -euo pipefail

export PATH="/sbin:/usr/sbin:${PATH}"

chain="CONTAINER_EGRESS"
ipset_v4="container_allowed"
domains_file="/etc/firewall/allowed-domains.txt"
user="${CONTAINER_USER:-agent}"
user_home="/home/${user}"

log() { printf '[titular] %s\n' "$*" >&2; }

command -v gosu >/dev/null 2>&1 || { log "falta gosu; no puedo bajar privilegios."; exit 1; }
[[ -r "${domains_file}" ]] || { log "no puedo leer ${domains_file}."; exit 1; }

# --- Cortafuegos de egreso -----------------------------------------------------------------

# IPv6 fuera, para que un registro AAAA no sea una puerta trasera.
if [[ -d /proc/sys/net/ipv6 ]]; then
  for p in /proc/sys/net/ipv6/conf/*/disable_ipv6; do
    [[ -w "${p}" ]] && echo 1 > "${p}" 2>/dev/null || true
  done 2>/dev/null || true
fi

if command -v iptables-legacy >/dev/null 2>&1; then
  iptables_cmd="$(command -v iptables-legacy)"
elif command -v iptables >/dev/null 2>&1; then
  iptables_cmd="$(command -v iptables)"
else
  log "no encuentro iptables; no puedo aplicar el cortafuegos."; exit 1
fi

dns_ip="$(awk '/^nameserver/ && $2 !~ /:/ {print $2; exit}' /etc/resolv.conf || true)"

ipset create "${ipset_v4}" hash:ip -exist 2>/dev/null || {
  log "no puedo crear el ipset (hace falta NET_ADMIN). El cortafuegos no se aplicaría."; exit 1
}
ipset flush "${ipset_v4}" 2>/dev/null || true

# getent primero: cubre /etc/hosts (--add-host) y DNS. dig como respaldo.
resolver_ipv4() {
  local host="$1"
  getent ahostsv4 "${host}" 2>/dev/null | awk '{print $1}' | sort -u
  dig +short "${host}" A 2>/dev/null | grep -E '^[0-9.]+$' || true
}

while IFS= read -r raw; do
  entry="${raw%%#*}"
  entry="$(echo "${entry}" | xargs || true)"
  [[ -z "${entry}" ]] && continue
  resolved=0
  while IFS= read -r addr; do
    [[ -z "${addr}" ]] && continue
    ipset add "${ipset_v4}" "${addr}" 2>/dev/null || true
    resolved=1
  done < <(resolver_ipv4 "${entry}" | sort -u)
  if [[ "${resolved}" == "0" ]]; then
    log "aviso: ${entry} no resolvió a IPv4; quedará bloqueado."
  fi
done < "${domains_file}"

entries="$(ipset list "${ipset_v4}" 2>/dev/null | awk '/Number of entries:/ {print $4; exit}')"
if [[ "${entries:-0}" == "0" ]]; then
  log "ningún dominio de ${domains_file} resolvió; no arranco."; exit 1
fi

"${iptables_cmd}" -N "${chain}" 2>/dev/null || true
"${iptables_cmd}" -F "${chain}"
"${iptables_cmd}" -C OUTPUT -j "${chain}" >/dev/null 2>&1 || "${iptables_cmd}" -I OUTPUT 1 -j "${chain}"

"${iptables_cmd}" -A "${chain}" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
"${iptables_cmd}" -A "${chain}" -o lo -j ACCEPT
if [[ -n "${dns_ip}" ]]; then
  "${iptables_cmd}" -A "${chain}" -p udp -d "${dns_ip}" --dport 53 -j ACCEPT
  "${iptables_cmd}" -A "${chain}" -p tcp -d "${dns_ip}" --dport 53 -j ACCEPT
fi
"${iptables_cmd}" -A "${chain}" -m set --match-set "${ipset_v4}" dst -j ACCEPT
"${iptables_cmd}" -A "${chain}" -j REJECT

log "egreso restringido a ${entries} direcciones de ${domains_file}."

# --- Datos personales del titular ----------------------------------------------------------

fixture="${MOCK_FIXTURE:-}"
if [[ -n "${fixture}" && ! -r "${fixture}" ]]; then
  log "MOCK_FIXTURE=${fixture} no existe o no se puede leer."; exit 1
fi

# --- Bloque de confianza ---------------------------------------------------------------------
# Un solo texto canónico (/etc/titular/instrucciones/confianza.md) y tres envoltorios. El
# encabezado cambia; la prosa nunca se duplica.

cli="${TITULAR_CLI:-claude}"
instr="/etc/titular/instrucciones"
workspace="${user_home}/workspace"
mkdir -p "${workspace}"

armar_contexto() {
  # $1 = encabezado, $2 = destino
  cat "$1" "${instr}/confianza.md" > "$2"
}

ctx_claude="${workspace}/$(printf 'CLAUDE')".md
ctx_codex="${workspace}/$(printf 'AGENTS')".md
ctx_pi="${user_home}/.pi/system-prompt-titular.md"
mkdir -p "${user_home}/.pi"

case "${cli}" in
  claude) armar_contexto "${instr}/encabezado-claude.md" "${ctx_claude}" ;;
  codex)  armar_contexto "${instr}/encabezado-codex.md"  "${ctx_codex}"  ;;
  pi)     armar_contexto "${instr}/encabezado-pi.md"     "${ctx_pi}"     ;;
  *) log "TITULAR_CLI debe ser claude, codex o pi (recibí '${cli}')."; exit 1 ;;
esac

# --- Modelo ------------------------------------------------------------------------------------
# claude y pi hablan con api.anthropic.com (claude-haiku-4-5, vía ANTHROPIC_API_KEY/ANTHROPIC_MODEL).
# codex sólo habla el dialecto OpenAI, así que va a Ollama Cloud.

if [[ "${cli}" == "codex" ]]; then
  : "${OLLAMA_BASE_URL:?codex necesita OLLAMA_BASE_URL en el --env-file}"
  : "${OLLAMA_API_KEY:?codex necesita OLLAMA_API_KEY en el --env-file}"
  mkdir -p "${user_home}/.codex"
  cat > "${user_home}/.codex/config.toml" <<EOF_CODEX
model = "${OLLAMA_MODEL:-gpt-oss:120b}"
model_provider = "ollama"

[model_providers.ollama]
name = "Ollama Cloud"
base_url = "${OLLAMA_BASE_URL}"
env_key = "OLLAMA_API_KEY"
wire_api = "chat"

[shell_environment_policy]
inherit = "all"
EOF_CODEX
  chown "${user}:${user}" "${user_home}/.codex/config.toml"
fi

# --- Configuración MCP del CLI ---------------------------------------------------------------

# shellcheck source=config-mcp.sh
source /usr/local/bin/config-mcp.sh
configurar_mcp "${cli}" "${user_home}" "${fixture}"

chown -R "${user}:${user}" "${workspace}" "${user_home}/.pi" 2>/dev/null || true
for d in "${user_home}/.claude" "${user_home}/.codex" "${user_home}/.config"; do
  [[ -e "${d}" ]] && chown -R "${user}:${user}" "${d}" 2>/dev/null || true
done
[[ -e "${user_home}/.claude.json" ]] && chown "${user}:${user}" "${user_home}/.claude.json" || true

exec gosu "${user}:${user}" "$@"
