# team-31 Platanus Hack 26: Santiago ft. Buk Project

**Current project logo:** project-logo.png

<img src="./project-logo.png" alt="Project Logo" width="200" />

Track: 🔗 Multiplayer

**Stack Nexo.** Web y el MCP remoto usan el broker de Nexo para gestionar permisos, solicitudes y avisos. [Arranque y verificación local](docs/local-stack.md).

**WhatsApp.** Vincula tu número a tu cuenta de Nexo para enviar solicitudes y consultar sus respuestas desde el teléfono. [Configurar Kapso y probar el flujo](docs/whatsapp.md).

**Demo local de coordinación.** La API de `apps/server` guarda grupos, disponibilidad y encuentros para la demo de fútbol. Corre `pnpm agents:up 3` en una terminal y `pnpm agents:demo 3` en otra. [Instrucciones para dos o más asistentes](apps/mcp/README.md).

### Dashboard con chat

En `/demo`, **Contactos de Ana** usa Claude Code y el mismo broker persistente que `agents:runtime-demo`. Inicia web y broker, ejecuta `pnpm agents:contacts:seed` y pregunta «¿A alguien le interesa la cerámica?». **Ver datos** muestra el ID y la decisión del broker para cada contacto. Necesitas Claude Code autenticado y la configuración del proxy en el entorno local. [Comandos para levantar el flujo de contactos](apps/mcp/README.md#buscar-entre-los-agentes-de-la-agenda)

Selecciona **Fútbol del sábado** para usar el chat de coordinación con Ollama.

Con Node 24, pnpm 10 y Docker, ejecuta `pnpm agents:up 3` y deja la API abierta. Luego levanta Ollama con **una** de estas opciones:

- **Docker:** `docker compose --profile demo-model up -d ollama` y luego `docker compose --profile demo-model exec ollama ollama pull qwen3:4b-instruct`.
- **Ollama nativo** (recomendado en Mac para usar la GPU): `pnpm with-env bash -c 'OLLAMA_HOST=127.0.0.1:$DEMO_MODEL_PORT ollama serve'`. En otra terminal, `pnpm with-env bash -c 'OLLAMA_HOST=127.0.0.1:$DEMO_MODEL_PORT ollama pull "${DEMO_MODEL:-qwen3:4b-instruct}"'`.

Si tu worktree ya tenía `.env`, ejecuta `pnpm env:init` para agregar el puerto del modelo. Inicia `pnpm dev --filter @team-31/web` y abre `/demo` en la URL que imprima Next.js. La primera descarga del modelo pesa alrededor de 2.5 GB. El chat no envía mensajes hasta que Ollama tenga instalado el modelo.

Como Ana, escribe **«¿A Bob le da para jugar tipo seis el sábado?»** y luego **«¿Y a las cuatro?»**. Cambia a Eva y repite la consulta para comparar. En cada respuesta puedes abrir **Ver datos** y copiar el JSON que devolvió la API. También puedes invitar a Bob y Carla, cambiar de identidad para responder con sus agendas y aceptar el horario con cada persona.

El modelo corre localmente y no requiere API key. Usa herramientas reales de la API, que sigue decidiendo qué puede ver cada identidad. Los calendarios son ficticios, el historial está separado por identidad y las credenciales de `.agents-local/` no salen del servidor web.

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
