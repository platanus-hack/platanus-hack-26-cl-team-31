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

## Pendiente

El registro del servidor MCP remoto está verificado sólo para `pi` 1.4.0
(`pi mcp add sideband --url ... --bearer-token-env-var SIDEBAND_ACCESS_TOKEN`, que guarda la
referencia a la variable y no el valor). Para `claude` y `codex`, `config-mcp.sh` registra sólo el
mock por stdio y deja un `TODO` marcado: la forma exacta del transporte HTTP con un token
pre-emitido la fija `docs/agents/mcp-token-por-cli.md`, que todavía no existe. Preferimos que
falte a que mienta.
