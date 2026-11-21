# Sideband

<img src="./project-logo.png" alt="Sideband" width="200" />

> **El protocolo de confianza para la comunicación entre agentes personales.**

Track: 🔗 Multiplayer

La forma en que nos comunicamos está cambiando. Cada vez más personas delegan tareas en asistentes de IA: organizar su agenda, responder mensajes, buscar información y coordinarse con otras personas. El siguiente paso es que esos asistentes puedan comunicarse entre sí.

Para que eso funcione a escala no basta con conectar agentes. Necesitamos saber quién está preguntando, en nombre de quién actúa, qué información puede consultar y qué puede compartir el otro agente.

**Sideband es esa capa de confianza.** Conecta el asistente de una persona con los agentes de sus contactos a través de un broker seguro. Cada titular mantiene el control sobre su identidad, sus permisos y sus datos. El agente puede coordinarse con otros agentes, pero nunca recibe más información de la autorizada.

Hoy Sideband funciona con usuarios reales y sus agentes conectados. También incluye un stack local con datos de prueba para reproducir el flujo sin depender de cuentas reales.

## Por qué importa

Los agentes personales no deberían estar aislados, pero tampoco deberían compartir nuestra vida completa para poder ayudarnos. Sideband permite una tercera opción: **colaboración entre agentes con consentimiento, permisos granulares y entrega mínima de información**.

El mismo protocolo que permite coordinar un partido puede ayudar a:

- encontrar donantes de sangre disponibles;
- compartir información de salud previamente autorizada durante una emergencia;
- coordinar cuidados familiares;
- construir mejores planes de salud con la información que cada persona decide compartir;
- conectar comunidades y organizaciones para responder más rápido ante necesidades reales.

Estos escenarios requieren consentimiento explícito y reglas claras. Sideband no da acceso médico automático ni reemplaza a profesionales de salud: proporciona la infraestructura para que una persona decida por adelantado qué puede consultar cada agente y contacto.

## Cómo funciona

1. Cada persona tiene una identidad y un agente conectado.
2. El agente solicitante pregunta a través del broker.
3. El broker autentica la identidad y evalúa los permisos del titular destinatario.
4. Si la consulta está autorizada, avisa al agente correcto sin enviar contenido innecesario.
5. La respuesta se valida, se filtra y se reduce a los campos permitidos.
6. Antes de entregarla, el broker verifica nuevamente que el permiso siga vigente.
7. El resultado final se firma y queda trazable para el titular.

Los agentes pueden equivocarse, ser manipulados o recibir instrucciones maliciosas. Por eso la seguridad no depende solamente de que el agente se comporte bien: **los permisos se aplican en el broker**.

## Pruébalo

El producto soporta usuarios y agentes reales. Para probarlo de forma reproducible y aislada, este repositorio incluye:

**Stack Sideband.** Web y el MCP remoto usan el broker de Sideband para gestionar permisos, solicitudes y avisos. [Arranque y verificación local](docs/local-stack.md).

**WhatsApp.** Vincula tu número a tu cuenta de Sideband para enviar solicitudes y consultar sus respuestas desde el teléfono. [Configurar Kapso y probar el flujo](docs/whatsapp.md).

**Demo local de coordinación.** La API de `apps/server` guarda grupos, disponibilidad y encuentros para una demo reproducible. Corre `pnpm agents:up 3` en una terminal y `pnpm agents:demo 3` en otra. [Instrucciones para dos o más asistentes](apps/mcp/README.md).

### Dashboard con chat

En `/demo`, **Contactos de Ana** usa Claude Code y el mismo broker persistente que `agents:runtime-demo`. En una instancia real, este flujo puede operar con usuarios y agentes conectados; para reproducirlo localmente, ejecuta `pnpm agents:contacts:seed` y pregunta «¿A alguien le interesa la cerámica?». **Ver datos** muestra el ID y la decisión del broker para cada contacto. [Comandos para levantar el flujo de contactos](apps/mcp/README.md#buscar-entre-los-agentes-de-la-agenda)

Selecciona **Fútbol del sábado** para usar el chat de coordinación con Ollama.

Con Node 24, pnpm 10 y Docker, ejecuta `pnpm agents:up 3` y deja la API abierta. Luego levanta Ollama con **una** de estas opciones:

- **Docker:** `docker compose --profile demo-model up -d ollama` y luego `docker compose --profile demo-model exec ollama ollama pull qwen3:4b-instruct`.
- **Ollama nativo** (recomendado en Mac para usar la GPU): `pnpm with-env bash -c 'OLLAMA_HOST=127.0.0.1:$DEMO_MODEL_PORT ollama serve'`. En otra terminal, `pnpm with-env bash -c 'OLLAMA_HOST=127.0.0.1:$DEMO_MODEL_PORT ollama pull "${DEMO_MODEL:-qwen3:4b-instruct}"'`.

Si tu worktree ya tenía `.env`, ejecuta `pnpm env:init` para agregar el puerto del modelo. Inicia `pnpm dev --filter @team-31/web` y abre `/demo` en la URL que imprima Next.js. La primera descarga del modelo pesa alrededor de 2.5 GB. El chat no envía mensajes hasta que Ollama tenga instalado el modelo.

Como Ana, escribe **«¿A Bob le da para jugar tipo seis el sábado?»** y luego **«¿Y a las cuatro?»**. Cambia a Eva y repite la consulta para comparar cómo cambian las respuestas según los permisos. En cada respuesta puedes abrir **Ver datos** y copiar el JSON que devolvió la API. También puedes invitar a Bob y Carla, cambiar de identidad para responder con sus agendas y aceptar el horario con cada persona.

El modelo corre localmente y no requiere API key. Usa herramientas reales de la API, que sigue decidiendo qué puede ver cada identidad. En esta reproducción local los calendarios son de prueba, el historial está separado por identidad y las credenciales de `.agents-local/` no salen del servidor web.

team-31

- Adolfo Manuel Villalobos Vega ([@adolfovillalobos](https://github.com/adolfovillalobos))
- Alfredo Enrione Martinez ([@aenrione](https://github.com/aenrione))
- Martín Peñaloza ([@mpenalozag](https://github.com/mpenalozag))
- Nicolás Andrés Cruz Mellado ([@ncruzm](https://github.com/ncruzm))
- Simón Oyaneder ([@SimonOyaneder](https://github.com/SimonOyaneder))

Before Submitting:

- ✅ Fill in the project metadata (name, oneliner, description and deploy URL) in platanus-hack-project.jsonc

- ✅ Replace the contents of project-description.md with your project description in markdown

- ✅ Provide a 1000x1000 png project logo, max 500kb

- ✅ Provide a concise and to the point readme.

## ⚠️ Deploying & integrations (Vercel, Render, etc.)

**Despliegue de este equipo.** El código se integra en `main` de este repo.
Cada push a `main` (incluido un merge desde GitHub) dispara **Sync from hackathon**
en [`mpenalozag/nexo-render`](https://github.com/mpenalozag/nexo-render/actions/workflows/sync.yml).
El espejo conserva sus archivos de despliegue, verifica el build y el typecheck
y publica su propio commit. Render despliega `nexo-team31` al recibir ese commit.
Para estos dos repos usa este flujo: sus ramas `main` tienen historiales diferentes.

**Configuración inicial:** crea un token de GitHub fine-grained limitado al repo
`mpenalozag/nexo-render`, con **Actions: Read and write**, y guárdalo como
`RENDER_MIRROR_ACTIONS_TOKEN` en **Settings → Secrets and variables → Actions**
del repo **original**. La corrida del original confirma que el espejo recibió
el disparo; la validación y publicación se ven en las Actions del espejo.

**Para un espejo nuevo con historial idéntico:**

Deploy platforms like **Vercel**, **Render** or **Netlify** can only connect to
repositories **you own** — they can't be granted access to this organization repo.
To deploy (or add any integration) while keeping your commits here, mirror your
code to a personal repo:

1. Create a **personal** repository on your own GitHub account.
2. Point your local `origin` at **both** repos, so a single `git push` updates each one:

   ```bash
   # this org repo (keep it as a push target)...
   git remote set-url --add --push origin https://github.com/platanus-hack/platanus-hack-26-cl-team-31.git
   # ...and your personal repo
   git remote set-url --add --push origin https://github.com/<your-user>/<your-repo>.git
   ```

   From now on `git push` sends every commit to **both** repositories.
3. Connect your deploy service (Vercel, Render, …) to your **personal** repo and deploy from there.

Your commits stay mirrored here for judging, while the deploy runs from the repo you control.

Have fun! 🚀
