# Token pre-emitido por CLI

Cómo registrar el MCP remoto de Sideband en `claude`, `codex` y `pi` con un access token ya
emitido, sin login interactivo ni navegador. Es lo que necesita `infra/titular/config-mcp.sh`
para la imagen del titular.

Verificado el 2026-11-21 contra `claude` 2.1.330, `codex-cli` 0.162.1 y `pi` 1.4.0, apuntando al
MCP real (`https://…tail88af94.ts.net:8443/mcp`, TLS, `NODE_ENV=production`).

| CLI | ¿Acepta un token pre-emitido? | Dónde vive la configuración |
| --- | --- | --- |
| `claude` | Sí, encabezado estático `Authorization` | `$CLAUDE_CONFIG_DIR/.claude.json` (por defecto `$HOME/.claude.json`) |
| `codex` | Sí, `bearer_token_env_var` | `$CODEX_HOME/config.toml` (por defecto `$HOME/.codex/config.toml`) |
| `pi` | Sí, `--bearer-token-env-var` | `$HOME/.pi/agent/mcp.json` |

Ninguno necesita `mcp login`. En los tres el token puede quedar **por referencia al entorno**,
no como valor en disco.

## claude

`claude mcp add` admite `--header`, y el valor se expande desde el entorno al conectar: basta
guardar `Bearer ${SIDEBAND_ACCESS_TOKEN}` literal.

```sh
claude mcp add sideband --scope user --transport http \
  "${TITULAR_MCP_URL}" \
  --header 'Authorization: Bearer ${SIDEBAND_ACCESS_TOKEN}'
```

Escribe en `$CLAUDE_CONFIG_DIR/.claude.json` (o `$HOME/.claude.json` si no está definida):

```json
{
  "mcpServers": {
    "sideband": {
      "type": "http",
      "url": "https://…tail88af94.ts.net:8443/mcp",
      "headers": { "Authorization": "Bearer ${SIDEBAND_ACCESS_TOKEN}" }
    }
  }
}
```

**Ojo con `CLAUDE_CONFIG_DIR`.** `claude mcp add` ignora `HOME` si esa variable está definida en
el entorno; escribe donde ella apunte. En el contenedor, o no la definas o apúntala al home del
usuario del contenedor.

Prueba headless (el mismo JSON, pasado con `--mcp-config` para no tocar la configuración real):

```sh
claude -p "Llama mcp__sideband__sideband_inbox sin argumentos y pega su salida cruda." \
  --model claude-haiku-4-5 \
  --mcp-config ./mcp.json --strict-mcp-config --setting-sources "" \
  --allowedTools "mcp__sideband__sideband_inbox"
```

Salida real:

```json
{"items":[]}
```

Antes de eso, con `sideband_check` el modelo leyó el esquema de la tool y pidió el `requestId`
obligatorio: la lista de tools llega completa.

## codex

`codex mcp add --url` registra un servidor Streamable HTTP y `--bearer-token-env-var` guarda el
**nombre de la variable**, nunca el token.

```sh
codex mcp add sideband \
  --url "${TITULAR_MCP_URL}" \
  --bearer-token-env-var SIDEBAND_ACCESS_TOKEN
```

Escribe en `$CODEX_HOME/config.toml` (por defecto `$HOME/.codex/config.toml`):

```toml
[mcp_servers.sideband]
url = "https://…tail88af94.ts.net:8443/mcp"
bearer_token_env_var = "SIDEBAND_ACCESS_TOKEN"
```

Prueba headless con `CODEX_HOME` aislado y el modelo OpenAI-compatible de la demo:

```sh
codex exec --skip-git-repo-check \
  "Llama la herramienta MCP sideband_inbox y pega su salida cruda. Nada mas."
```

Salida real:

```
mcp: sideband/sideband_inbox started
mcp: sideband/sideband_inbox (completed)
codex
{"items":[]}
```

Dos trampas del `config.toml`, ajenas al MCP pero que bloquean la prueba:

- Es TOML: las claves sueltas (`model`, `model_provider`, `approval_policy`) van **antes** de
  cualquier `[tabla]`. Si las agregas al final quedan dentro de `[mcp_servers.sideband]` y codex
  las ignora con un aviso, cayendo al proveedor por defecto.
- `wire_api = "chat"` ya no existe en 0.162.1; usa `"responses"`. El id `ollama` está reservado:
  nombra el proveedor de otra forma (`ollama-cloud`).

## pi

Ya resuelto y en uso en `infra/titular/config-mcp.sh`. Misma forma que codex:

```sh
pi mcp add sideband --url "${TITULAR_MCP_URL}" --bearer-token-env-var SIDEBAND_ACCESS_TOKEN
```

Escribe `$HOME/.pi/agent/mcp.json` con la referencia al entorno, no con el valor.

## Stream GET de Streamable HTTP

Medido con un proxy HTTP local que registra método y ruta entre el CLI y el MCP.

- **`claude` sí abre el GET.** Después de `initialize` emite `GET /mcp` con
  `accept: text/event-stream`. Nuestro servidor responde 405 y el cliente sigue funcionando sin
  error visible: la llamada a la tool se completó igual. Si algún día queremos push al titular,
  claude ya lo pediría.
- **`codex` no abre el GET.** Sólo POST (`initialize`, `notifications/initialized`, `tools/list`,
  `tools/call`). Nunca intentó GET ni DELETE.
- El servidor hoy responde 405 tanto a `GET /mcp` como a `DELETE /mcp`.

## Para la imagen del titular

El token entra por `--env-file` como `SIDEBAND_ACCESS_TOKEN` y los tres CLI lo leen del entorno
del proceso. El archivo de configuración se puede hornear en la imagen con la referencia
`${SIDEBAND_ACCESS_TOKEN}`; sólo el valor es por contenedor.

`TITULAR_MCP_URL` debe coincidir byte a byte con `MCP_RESOURCE_URL` del servidor.

## Notas sueltas

- Sin encabezado `Authorization` el MCP responde 401; con uno válido, 200. La autorización no es
  el problema en ninguno de los tres CLI.
- Observado, causa **no confirmada**: un token del usuario fijo `Ana Prueba` devolvía 409
  (`-32000`, «La solicitud entra en conflicto con el estado actual.») en *todos* los métodos,
  incluido `initialize`, mientras tokens recién emitidos con nombres distintos respondían 200.
  Persistió después de la sesión. No parece causado por el CLI; si aparece, emite un token nuevo.
