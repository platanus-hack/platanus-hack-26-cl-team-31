# Demo local con contactos ficticios

## Contactos de Ana

Sigue los [pasos para iniciar la web y el broker y preparar los contactos](../apps/mcp/README.md#buscar-entre-los-agentes-de-la-agenda). Con Claude Code autenticado, abre `/demo` en la web local, selecciona **Contactos de Ana** y pregunta «¿A alguien le interesa la cerámica?». **Ver datos** muestra el ID y la decisión del broker para cada contacto. El chat usa el mismo broker persistente que `agents:runtime-demo`.

## Fútbol del sábado

Este chat usa Ollama y la API de coordinación de `apps/server`, con calendarios de prueba. Con Node 24, pnpm 10 y Docker, ejecuta `pnpm agents:up 3` y deja la API abierta. Para probar la coordinación desde la terminal, ejecuta `pnpm agents:demo 3` en otra. Para usar el chat, levanta Ollama con una de estas opciones:

- **Docker:** `docker compose --profile demo-model up -d ollama` y luego `docker compose --profile demo-model exec ollama ollama pull qwen3:4b-instruct`.
- **Ollama nativo** (recomendado en Mac para usar la GPU): `pnpm with-env bash -c 'OLLAMA_HOST=127.0.0.1:$DEMO_MODEL_PORT ollama serve'`. En otra terminal, `pnpm with-env bash -c 'OLLAMA_HOST=127.0.0.1:$DEMO_MODEL_PORT ollama pull "${DEMO_MODEL:-qwen3:4b-instruct}"'`.

Si tu worktree ya tenía `.env`, ejecuta `pnpm env:init` para agregar el puerto del modelo. Inicia `pnpm dev --filter @team-31/web`, abre `/demo` en la URL que imprima Next.js y selecciona **Fútbol del sábado**. La primera descarga del modelo pesa alrededor de 2.5 GB. El chat no envía mensajes hasta que Ollama tenga instalado el modelo.

Como Ana, pregunta «¿A Bob le da para jugar tipo seis el sábado?» y luego «¿Y a las cuatro?». Cambia a Eva y repite la consulta para comparar qué puede ver cada identidad. **Ver datos** muestra el JSON que devolvió la API. También puedes invitar a Bob y Carla, cambiar de identidad para responder con sus agendas y aceptar el horario con cada persona.

El modelo corre localmente sin API key. La API decide qué puede ver cada identidad, el historial está separado por identidad y las credenciales de `.agents-local/` no salen del servidor web.
