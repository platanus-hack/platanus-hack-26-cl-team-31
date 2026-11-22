# Imagen «titular»

Un contenedor = un CLI de agente = un titular de Sideband.

Cada contenedor lleva exactamente dos servidores MCP:

- **`sideband`** — el MCP remoto por HTTPS, a través del túnel Tailscale.
- **`titular`** — el mock MCP local por stdio (`mock-mcp/mock-mcp.mjs`), con el fixture
  personal del titular (`mock-mcp/fixtures/<titular>.json`). Datos falsos y deterministas.

La imagen deriva de `~/my-github/os/ai-containers` (Debian trixie, `codex`, `claude-code` por
npm, cortafuegos de egreso por ipset/iptables) con tres diferencias: sale de `TARGETARCH` en vez
de fijar aarch64, suma `pi`, y quita lo que un titular no usa (Go, opencode, gh, agente SSH).

## Construir

```bash
./infra/titular/build.sh
TITULAR_PLATFORM=linux/amd64 ./infra/titular/build.sh   # la otra máquina del proyecto
```

## Levantar dos titulares en dos redes

```bash
./infra/titular/up.sh claude ana
./infra/titular/up.sh codex  bob     # en otra terminal
```

`up.sh` crea la red `sideband-<titular>` si falta y mete ahí al contenedor. **Ana y Bob viven en
redes Docker distintas y no se ven entre sí**: el único camino entre sus agentes es el broker de
Sideband. Esa incomunicación no es comodidad, es lo que la prueba demuestra.

El host del túnel no tiene DNS dentro de Docker, así que entra por
`--add-host alfredo-martnezs-macbook-pro.tail88af94.ts.net:100.89.38.113`. La URL se queda byte a
byte igual a `MCP_RESOURCE_URL`: OAuth compara emisor y audiencia por igualdad exacta, de modo que
sustituir el host por la IP rompe la autorización. La IP sólo resuelve el nombre, nunca lo
reemplaza.

## Lo que deliberadamente no se alcanza

El entrypoint resuelve `allowed-domains.txt` a IPv4, lo mete en un ipset y hace `REJECT` de todo
lo demás (IPv6 queda apagado para que un registro AAAA no sea una puerta trasera). La lista
completa son tres entradas:

| Destino | Para qué |
| --- | --- |
| `alfredo-martnezs-macbook-pro.tail88af94.ts.net` | El MCP de Sideband. Única vía hacia el otro titular. |
| `api.anthropic.com` | Modelo de `claude` y de `pi` (`claude-haiku-4-5`). |
| `ollama.com` | Modelo de `codex` (Ollama Cloud, `gpt-oss:120b`; codex sólo habla el dialecto OpenAI). |

Fuera quedan GitHub, npm, PyPI, el resto de internet y —sobre todo— **el contenedor del otro
titular**. Que el agente llegue a Sideband y a su modelo, y a nada más, es justamente lo que esta
prueba demuestra: no abras la lista por comodidad. Cada línea nueva necesita una razón escrita en
el PR.

## Secretos

Entran por `docker run --env-file`, desde un archivo **fuera del repo**
(`~/.config/sideband/titular-<titular>.env`, `chmod 600`). Nunca horneados en la imagen y nunca
por `-e CLAVE=valor`, que los deja en el historial del shell y en la lista de procesos. `up.sh`
rechaza un archivo que esté dentro del repo y avisa si los permisos no son 600.

```sh
# ~/.config/sideband/titular-ana.env
ANTHROPIC_API_KEY=...          # claude y pi
OLLAMA_BASE_URL=https://ollama.com/v1   # codex
OLLAMA_API_KEY=...
OLLAMA_MODEL=gpt-oss:120b
TITULAR_MCP_URL=https://alfredo-martnezs-macbook-pro.tail88af94.ts.net:8443/mcp
SIDEBAND_ACCESS_TOKEN=...
```

El access token se emite sin navegador:

```bash
curl -sS -X POST \
  -H 'content-type: application/json' \
  -H 'origin: https://alfredo-martnezs-macbook-pro.tail88af94.ts.net' \
  --data '{"name":"Ana Prueba"}' \
  https://alfredo-martnezs-macbook-pro.tail88af94.ts.net/api/dev-token
```

`config-mcp.sh` corre **dentro** del contenedor: así el token va del `--env-file` al archivo de
configuración del CLI sin tocar nunca el disco del host.

## Levantar un titular

```bash
./infra/titular/up.sh claude caja01
./infra/titular/up.sh codex  caja02     # en otra terminal
```

`up.sh` hace el alta completa antes de arrancar el contenedor: `infra/titular/titular.mjs` emite
el access token contra el stack del worktree (dev-login → dev-token → `/v1/owner/address`,
la misma secuencia que el arnés de `infra/sim`), arma un `--env-file` con `umask 077` **fuera del
repo** y lo borra al salir. El token nunca pasa por argv, nunca se imprime entero y nunca se
hornea en la imagen. Las credenciales del modelo salen del `.env.local` del worktree.

Para que dos titulares puedan preguntarse, antes tienen que ser contactos con el reparto que la
pregunta necesita:

```bash
node infra/titular/titular.mjs conectar Caja01 Caja02 interests,availability
```

Ni `up.sh` ni `titular.mjs` revocan jamás una conexión de agente: la revocación es irreversible y
deja al titular inservible. Ante una identidad quemada, los dos scripts fallan pidiendo un nombre
nuevo.

El `<titular>` del argumento es el slug en minúsculas; el nombre en Sideband sale de
`TITULAR_OWNER_NAME` o del slug capitalizado. `TITULAR_FIXTURE` elige el fixture cuando el slug no
tiene uno propio en `mock-mcp/fixtures/`.

## Registro del MCP remoto, por CLI

Verificado contra el MCP real (TLS, `NODE_ENV=production`) y documentado en
[docs/agents/mcp-token-por-cli.md](../../docs/agents/mcp-token-por-cli.md). En los tres CLI el
token queda **por referencia al entorno**, nunca como valor en disco.

| CLI | Registro | Archivo |
| --- | --- | --- |
| `claude` | `claude mcp add sideband --scope user --transport http "$TITULAR_MCP_URL" --header 'Authorization: Bearer ${SIDEBAND_ACCESS_TOKEN}'` | `$CLAUDE_CONFIG_DIR/.claude.json` |
| `codex` | `codex mcp add sideband --url "$TITULAR_MCP_URL" --bearer-token-env-var SIDEBAND_ACCESS_TOKEN` | `$CODEX_HOME/config.toml` |
| `pi` | `pi mcp add sideband --url "$TITULAR_MCP_URL" --bearer-token-env-var SIDEBAND_ACCESS_TOKEN` | `$HOME/.pi/agent/mcp.json` |

Tres trampas que ya están pagadas en `config-mcp.sh` y en `entrypoint.sh`:

- `claude mcp add` **ignora `HOME` cuando `CLAUDE_CONFIG_DIR` existe**. Ambas quedan fijadas a
  mano, en la configuración y en el `exec` final, para que el CLI lea lo que se escribió.
- `codex mcp add` se queda esperando en stdin sin `< /dev/null`.
- El `config.toml` de codex es TOML: las claves sueltas del modelo van **antes** de cualquier
  tabla, así que el entrypoint lo escribe primero y `codex mcp add` agrega `[mcp_servers.*]`
  después. `wire_api` es `"responses"` (no `"chat"`) y el id `ollama` está reservado, de modo que
  el proveedor se llama `ollama-cloud`.

## Bloque de confianza

Una sola copia de la prosa (`instrucciones/confianza.md`) y tres envoltorios
(`encabezado-claude.md`, `encabezado-codex.md`, `encabezado-pi.md`). El entrypoint concatena
encabezado + prosa en el lugar nativo de cada CLI: `workspace/CLAUDE.md`, `workspace/AGENTS.md` o
`~/.pi/system-prompt-titular.md` (que `up.sh` pasa con `--append-system-prompt`).
