# team-31 Platanus Hack 26: Santiago ft. Buk Project

**Current project logo:** project-logo.png

<img src="./project-logo.png" alt="Project Logo" width="200" />

Track: 🔗 Multiplayer

**Demo local de coordinación.** Corre `pnpm agents:up 3` en una terminal y `pnpm agents:demo 3` en otra. [Instrucciones para dos o más asistentes](apps/mcp/README.md).

### Dashboard con chat

Con Node 24, pnpm 10 y Docker:

1. Ejecuta `pnpm agents:up 3` y deja la API abierta.
2. En otra terminal, corre `pnpm dev --filter @team-31/web` y abre la URL local que imprima Next.js.
3. Como Ana, pregunta si Bob está libre a las 18:00. Cambia a Eva y repite la pregunta. El inspector muestra el resumen y permite copiar el JSON que devolvió la API.
4. Como Ana, pulsa **Proponer fútbol**; como Bob y Carla, pulsa **Responder con mi agenda**. Después pulsa **Aceptar** con las tres identidades. La última aceptación devuelve `confirmed`.

El chat usa comandos guiados, sin un modelo de IA. Las respuestas vienen de la API del worktree y los datos de la agenda son ficticios. El selector de identidades solo funciona en desarrollo local: las credenciales de `.agents-local/` no salen del servidor web.

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
