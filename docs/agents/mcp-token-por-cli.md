# Token pre-emitido por CLI

Pregunta: ¿cada CLI de agente puede usar un access token OAuth ya emitido contra el MCP remoto, sin login en el navegador? Respuesta corta: **sí, los tres**.

Verificado el 2026-11-21 contra el MCP del worktree publicado por Tailscale (`https://<host>.ts.net:8443/mcp`, TLS real, `NODE_ENV=production`), con tokens de `POST /api/dev-token` y un titular recién creado.

| CLI | Token pre-emitido | Header arbitrario | `${VAR}` en la config | Abre el stream GET |
| --- | --- | --- | --- | --- |
| claude 2.1.330 | sí | sí | sí | sí (tolera 405) |
| codex 0.162.1 | sí | no, solo bearer | sí (`bearer_token_env_var`) | no |
| pi 1.4.0 | sí | sí | sí | sí (tolera 405) |

Ninguno escribe el token en su estado: después de cada corrida, buscar el prefijo del token dentro del directorio de configuración aislado no encuentra nada. El contenedor monta la config y pasa el token por variable de entorno.

## claude

**Veredicto: sí.** Header estático por `--mcp-config`, sin `claude mcp login`.

```json
{
  "mcpServers": {
    "sideband": {
      "type": "http",
      "url": "https://<host>:8443/mcp",
      "headers": { "Authorization": "Bearer ${SIDEBAND_TOKEN}" }
    }
  }
}
```

```sh
SIDEBAND_TOKEN=<token> CLAUDE_CONFIG_DIR=/tmp/sondeo/claude-home ANTHROPIC_API_KEY=... \
claude -p "Llama sideband_contacts sin argumentos y pega su resultado crudo." \
  --mcp-config /tmp/sondeo/claude-mcp.json --strict-mcp-config --setting-sources "" \
  --model claude-haiku-4-5 --allowedTools "mcp__sideband__sideband_contacts" < /dev/null
```

Salida: `Resultado:` y luego `{"contacts":[],"circles":[]}`.

- **Credenciales.** El header vive en el archivo que pasa `--mcp-config`; `${VAR}` se expande desde el entorno. El estado del CLI va a `CLAUDE_CONFIG_DIR`. Con token estático no se guarda nada de OAuth.
- **Stream GET.** Sí lo abre, justo después de `notifications/initialized`, y sigue adelante con el 405. Observado en un proxy que registra cada petición:

  ```
  POST /mcp rpc=server/discover            -> 400 (Unsupported protocol version: 2026-07-28)
  POST /mcp rpc=initialize                 -> 200
  POST /mcp rpc=notifications/initialized  -> 202
  GET  /mcp accept=text/event-stream       -> 405
  POST /mcp rpc=tools/list                 -> 200
  POST /mcp rpc=tools/call                 -> 200
  ```

  Antes de todo intenta `server/discover` con `MCP-Protocol-Version: 2026-07-28`, que el servidor rechaza con 400 y luego renegocia a `2025-11-25`. No es fatal.

## codex

**Veredicto: sí**, con una restricción: solo acepta bearer por variable de entorno. No hay opción de header arbitrario.

```toml
[mcp_servers.sideband]
url = "https://<host>:8443/mcp"
bearer_token_env_var = "SIDEBAND_TOKEN"
```

Equivalente: `codex mcp add sideband --url <url> --bearer-token-env-var SIDEBAND_TOKEN`.

```sh
CODEX_HOME=/tmp/sondeo/codex-home SIDEBAND_TOKEN=<token> OLLAMA_API_KEY=... \
codex exec --skip-git-repo-check --sandbox read-only \
  "Llama la tool MCP sideband_contacts sin argumentos y pega su resultado crudo." < /dev/null
```

Salida:

```
mcp: sideband/sideband_contacts started
mcp: sideband/sideband_contacts (completed)
codex
Here is the raw result from the `mcp__sideband_sideband_contacts` call:
{ "contacts": [], "circles": [] }
```

- **Credenciales.** El archivo `config.toml` dentro de `CODEX_HOME`. El token nunca se escribe ahí: solo el nombre de la variable. `CODEX_HOME` aísla toda la configuración.
- **Stream GET.** No lo abre. Solo POST:

  ```
  POST /mcp rpc=initialize                 -> 200
  POST /mcp rpc=notifications/initialized  -> 202
  POST /mcp rpc=tools/list                 -> 200
  POST /mcp rpc=tools/call                 -> 200
  ```

- **Modelo.** `codex` solo habla OpenAI. Ollama Cloud sirve, pero 0.162 ya no acepta `wire_api = "chat"` y reserva el id `ollama`, así que el proveedor va con otro nombre y la API de Responses:

  ```toml
  model = "gpt-oss:120b"
  model_provider = "ollama-cloud"

  [model_providers.ollama-cloud]
  name = "Ollama Cloud"
  base_url = "https://ollama.com/v1"
  env_key = "OLLAMA_API_KEY"
  wire_api = "responses"
  ```

  Las claves de nivel superior van antes de cualquier tabla, o quedan dentro de `[mcp_servers.sideband]` y `codex` las ignora. `codex exec` además se queda esperando stdin: hay que cerrarlo con `< /dev/null`.
- **No confirmado.** Si acepta el token literal en `config.toml` (alguna clave `bearer_token`) en vez de la variable.

## pi

**Veredicto: sí.** Header estático en `mcp.json`, sin `pi mcp login`.

```json
{
  "mcpServers": {
    "sideband": {
      "url": "https://<host>:8443/mcp",
      "headers": { "Authorization": "Bearer ${SIDEBAND_TOKEN}" }
    }
  }
}
```

Equivalente: `pi mcp add sideband --url <url> --bearer-token-env-var SIDEBAND_TOKEN` (también existe `--header KEY=VALUE`).

```sh
PI_CODING_AGENT_DIR=/tmp/sondeo/pi-home SIDEBAND_TOKEN=<token> ANTHROPIC_API_KEY=... \
pi -p "Llama la tool MCP sideband_contacts sin argumentos y pega su resultado crudo." \
  --no-skills --no-session --no-context-files --model claude-haiku-4-5 < /dev/null
```

Salida:

```json
{
  "content": [{ "type": "text", "text": "{\"contacts\":[],\"circles\":[]}" }],
  "structuredContent": { "contacts": [], "circles": [] }
}
```

`pi mcp list` sirve como chequeo sin gastar modelo: `sideband: connected, 15 tools (codemode, global)`.

- **Credenciales.** El archivo `mcp.json` dentro de `PI_CODING_AGENT_DIR`; en proyectos de confianza también `.pi/mcp.json` del proyecto.
- **`--mcp-config` no sirve para aislar.** Es un flag que registra la extensión MCP, así que con `--no-extensions` desaparece y `pi` aborta con `Error: Unknown option: --mcp-config`. El aislamiento real es `PI_CODING_AGENT_DIR`.
- **Stream GET.** Sí lo abre, después de `notifications/initialized`, y sigue con el 405:

  ```
  POST /mcp rpc=initialize                 -> 200
  POST /mcp rpc=notifications/initialized  -> 202
  GET  /mcp accept=text/event-stream       -> 405
  POST /mcp rpc=tools/list                 -> 200
  POST /mcp rpc=tools/call                 -> 200
  ```

## Si se habilita push en vez de polling

Dos de tres clientes ya abren el `GET /mcp` por su cuenta y aceptan el 405 sin romperse. Contestar ese GET con un stream SSE les daría notificaciones iniciadas por el servidor sin cambiar nada del lado del cliente. `codex` no lo abre, así que para él esa vía no existe y hay que dejarle el polling.

## Lo que estorbó, y no fueron los CLIs

- **409 por titular existente.** Con los titulares `Ana Prueba` y `Bob Prueba`, toda petición al MCP devuelve `409 {"code":-32000,"message":"La solicitud entra en conflicto con el estado actual."}`, incluido `initialize`. Viene de `agent.connect(principal)` en `apps/mcp/src/http.ts:142`, no del transporte. Un titular recién creado funciona y su token se reutiliza sin problema. Pendiente de revisar por quien sea dueño de `agent.connect`.
- **El stack se cayó a media prueba** (web 500, MCP 502 durante ~25 min) por un merge en curso en otro worktree. Los 502 que aparecen en los primeros registros de `codex` son eso, no un fallo del CLI.

## Aislamiento de la configuración personal

Las corridas usaron `CLAUDE_CONFIG_DIR`, `CODEX_HOME` y `PI_CODING_AGENT_DIR` apuntando a `/tmp`. Comparando `stat` antes y después:

- La config global de claude: sin cambios (mtime de agosto).
- La config global de codex: sin cambios. Solo cambió la mtime de un auxiliar que `codex` extrae siempre en su directorio temporal.
- El directorio global de pi: sin archivos nuevos ni `mcp.json`; solo cambió la mtime del directorio.
- La extensión `context-mode` de pi sí escribió sesiones nuevas en su carpeta global, pese a `--no-session`. No contienen el token.
