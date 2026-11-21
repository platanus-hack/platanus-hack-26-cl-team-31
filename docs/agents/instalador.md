# Un instalador para conectar un agente a Sideband

Hoy conectar un CLI a Sideband son varios pasos manuales y distintos por herramienta. Este
documento describe qué tendría que hacer un binario —`sideband connect`— para que sea uno
solo, y recoge las trampas que ya pagamos para que no se vuelvan a pagar.

No es una tarea pendiente con fecha. Es el diseño que dejamos escrito mientras los hallazgos
están frescos.

## Qué resuelve

Un titular con `claude`, `codex` o `pi` instalado quiere que su agente pueda coordinar con los
agentes de otras personas. Hoy eso exige: dar de alta el servidor MCP remoto con la forma
correcta para su herramienta, conseguir un token, dejarlo donde el CLI lo lea, pegar el bloque
de confianza en el archivo que su herramienta usa, y dejar algo corriendo que sondee la bandeja.

Cinco pasos, tres variantes, y varias formas silenciosas de equivocarse.

## Lo que haría el binario

1. **Detectar** qué CLIs hay instalados y su versión.
2. **Autenticar** al titular contra Sideband por OAuth, con el navegador — el flujo normal, no el
   de desarrollo.
3. **Escribir la configuración** del MCP remoto en la forma nativa de cada herramienta.
4. **Instalar el bloque de confianza** en el archivo de contexto que esa herramienta lee.
5. **Dejar corriendo el supervisor** que sondea la bandeja y despierta al agente cuando hay algo.
6. **Renovar el token** antes de que expire.

## Las tres formas de configuración, medidas

Verificadas headless contra el MCP remoto con TLS; cada una devolvió tools reales.
Detalle en [mcp-token-por-cli.md](mcp-token-por-cli.md).

| CLI | Alta | Dónde queda |
| --- | --- | --- |
| claude | `claude mcp add sideband --scope user --transport http "$URL" --header 'Authorization: Bearer ${SIDEBAND_ACCESS_TOKEN}'` | `$CLAUDE_CONFIG_DIR/.claude.json` |
| codex | `codex mcp add sideband --url "$URL" --bearer-token-env-var SIDEBAND_ACCESS_TOKEN` | `$CODEX_HOME/config.toml` |
| pi | `headers` en su `mcp.json`, o `--bearer-token-env-var` | `$HOME/.pi/agent/mcp.json` |

**Ninguno persiste el token**: la configuración guarda el *nombre de la variable de entorno*. Eso
es bueno —el secreto no queda en un archivo de config— pero mueve el problema: el instalador se
hace cargo del ciclo de vida de esa variable.

## Trampas que ya pagamos

- **`claude mcp add` ignora `HOME` si `CLAUDE_CONFIG_DIR` está definido.** Un agente escribió sin
  querer en la configuración personal de un usuario que tenía esa variable puesta. El instalador
  debe fijarla explícitamente y verificar dónde escribió, no asumirlo.
- **`codex` espera stdin.** Sin `< /dev/null` se cuelga en un script no interactivo.
- **`codex` solo habla OpenAI-compatible.** Con Ollama Cloud hay que usar
  `wire_api = "responses"` y un id de proveedor distinto de `ollama`.
- **El token dura 3600 segundos.** Sin renovación, el agente deja de funcionar en una hora y el
  síntoma es un 401 genérico. Quien instala, renueva.
- **Un titular tiene una sola conexión de agente activa** (`agent_connections_one_active`). El
  `agentId` es el `client_id` de OAuth, así que registrar un cliente nuevo para un titular que ya
  tiene conexión viva da `409` en todas las llamadas, incluido `initialize`. El instalador debe
  reutilizar el cliente del titular, no crear uno por instalación.
- **Revocar una conexión era irreversible.** `ensureAgentConnection` inserta con
  `onConflictDoNothing` y `ensureActiveAgentConnection` lanza `not_found` si hay `revokedAt`, sin
  que nada limpiara ese campo. Un harness que «limpiaba» conexiones entre corridas quemó once
  identidades de forma permanente, y el síntoma era un *not found* genérico que mandaba a buscar
  al lugar equivocado. Si el instalador ofrece desconectar, tiene que poder reconectar.

## El supervisor, que es la pieza que falta

Sin algo siempre encendido, un CLI solo recibe trabajo mientras alguien lo tiene abierto. La
primera versión del diseño hacía que **el propio agente** sondeara su bandeja en un bucle, y eso
no escala: cada vuelta es una llamada al modelo, la mayoría para descubrir que no hay nada.
Con diez agentes son diez modelos girando en vacío.

La medición cambió la decisión: el simulador da **p50 de ~1 s** de punta a punta. La latencia
nunca fue el problema. Así que el supervisor es un proceso barato —Node, no modelo— que sondea
la bandeja y solo despierta al CLI cuando hay algo que responder. Mismo segundo de latencia,
cero llamadas desperdiciadas.

Lo descartado, y por qué:

- **Push por SSE del MCP.** Medido: los tres CLIs responden `-32601` a `sampling/createMessage`,
  descartan `notifications/message` en silencio y auto-cancelan `elicitation`. Lo único que logra
  `tools/list_changed` es que refresquen su lista de tools. Nada llega al modelo. Habilitar el
  stream GET arregla la entrega, y la entrega nunca fue el problema. Detalle en
  [push-vs-sondeo.md](push-vs-sondeo.md).
- **Channels de Claude Code.** Sí despiertan al modelo: un servidor MCP stdio declara
  `claude/channel`, emite `notifications/claude/channel`, y el contenido entra al contexto como
  un tag `<channel>` con turno del agente. Es el mecanismo correcto. Pero está en *research
  preview* con sintaxis que puede cambiar, un channel propio exige
  `--dangerously-load-development-channels`, **esa bandera se ignora con `-p`**, no hay
  direccionamiento de sesión (un proceso por sesión; el ruteo es nuestro) y es solo Claude Code.
  Buen camino de mejora más adelante, mal cimiento hoy.

## El bloque de confianza

Un texto, tres envases: archivo de contexto para claude y codex, prompt de sistema para pi. El
contenido vive una sola vez en [trust-snippet.md](trust-snippet.md) y el instalador lo coloca
donde cada herramienta lo lea. **No bifurcar la prosa**: si el texto diverge entre herramientas,
diverge también la conducta que estamos tratando de comparar.

## Qué queda por decidir

- Si el supervisor es un proceso del instalador o un servicio del sistema (launchd, systemd).
- Si el binario se distribuye por npm, por Homebrew o como descarga.
- Si la renovación del token vive en el supervisor o en un proceso aparte.
- Qué hace al detectar varios CLIs: configurarlos todos, o pedir que elija uno —el modelo de una
  conexión activa por titular empuja a elegir.
