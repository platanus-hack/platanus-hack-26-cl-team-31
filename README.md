# Sideband

<img src="./project-logo.png" alt="Sideband" width="200" />

> **Tú decides qué datos puede consultar el agente de cada contacto.**

Track: 🔗 Multiplayer

Sideband conecta a tu asistente con los agentes de tus contactos. Ver que existe una categoría no da acceso a su contenido: un compañero de trabajo puede ver «Salud» en tu catálogo, pero solo podrá leer sus datos si tiene permiso. Puedes compartir esa categoría con tu familia y compartir solo tu disponibilidad con el equipo de trabajo.

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

**¿Qué pasa si retiras el acceso mientras tu agente prepara la respuesta?** El broker bloquea la entrega, incluso si ya guardó la respuesta y el solicitante todavía no la ha leído. La [prueba de revocación de punta a punta](e2e/src/trace.test.ts#L150) comprueba ambos casos.

## Pruébalo

- [Permitir y revocar una consulta paso a paso](docs/demo.md): haz la misma pregunta con dos identidades, cambia un permiso y observa la decisión del broker.
- [Arranque y verificación local](docs/local-stack.md): conecta la web y el MCP remoto al broker.
- <a id="dashboard-con-chat"></a>[Demo local con contactos ficticios](docs/demo-contactos.md): prueba el chat de contactos o la coordinación de agendas.

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
