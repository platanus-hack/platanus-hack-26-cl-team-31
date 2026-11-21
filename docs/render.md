# Desplegar Sideband en Render

## Stack completo (`render.yaml`)

El Blueprint `render.yaml` crea todo en un workspace de Render:

| Recurso | Tipo | Qué corre |
| --- | --- | --- |
| `sideband-web` | web | Next (OAuth, interfaz) y el MCP en loopback. `/mcp`, `/healthz` y la metadata OAuth se reenvían al MCP, así que el MCP público es `https://<web>/mcp`. |
| `sideband-broker` | servicio privado | Broker HTTP y worker. Solo se alcanza desde la red interna. |
| `sideband-admin` | web | Panel y MCP de administración. |
| `sideband-coordination` | web | API de coordinación (`apps/server`). |
| `sideband-db` | Postgres 17 | Base `app`, solo red privada. |
| `sideband-autodeploy` | cron (cada 5 min) | Despliega los servicios cuando cambia `main`. |

Costo aproximado: 4 servicios starter ($7) + Postgres basic-256mb con 1 GB ($6,30) + cron (~$1) ≈ $35/mes.

**Deploy al mergear a `main`.** Render no puede instalar su app de GitHub en la org, así que los servicios usan la URL pública del repo y `autoDeployTrigger` está apagado. El cron `infra/render/autodeploy.mjs` lee el commit de `main` (git smart HTTP, sin la API de GitHub) y, por cada servicio cuyo último deploy sea de otro commit, crea un deploy con la API de Render. Un deploy fallido no se reintenta: se corrige con el siguiente merge o con **Manual Deploy**. Necesita `RENDER_API_KEY` (Account Settings → API Keys) en el entorno del cron.

**URLs.** Render agrega un sufijo a los nombres del Blueprint (`sideband-web-xxxx`). Por eso `BETTER_AUTH_URL`, `MCP_RESOURCE_URL`, `AUTH_ISSUER`, `AUTH_JWKS_URL` y `ADMIN_URL` se derivan de `RENDER_EXTERNAL_URL` en el comando de arranque, y `BROKER_URL` del `hostport` interno del broker.

**Secretos.** Las variables `sync: false` se cargan al aprobar el Blueprint y viven solo en Render. Las llaves Ed25519 se generan como en `infra/gen-keys.ts`; `SERVICE_JWT_PUBLIC_KEYS` lleva las públicas de `web`, `mcp` y `admin`. No cambies `WAKE_SECRETS_KEY` después del primer deploy. Para iniciar sesión hacen falta `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` en web (redirect `https://<web>/api/auth/callback/google`) y `ADMIN_GOOGLE_CLIENT_ID`/`ADMIN_GOOGLE_CLIENT_SECRET` en admin.

Crear el Blueprint con el CLI de Render (≥ 2.38):

```sh
render blueprints validate render.yaml
render ea blueprints create --repo https://github.com/platanus-hack/platanus-hack-26-cl-team-31 --branch main --path render.yaml --auto-sync=false
# completar ~/.render/state/manual-env-vars/<exs-id>.json y luego:
render ea blueprints approve <exs-id>
```

Después de cambiar `render.yaml` en `main`: `render ea blueprints plan <exs-id>` y `render ea blueprints approve <exs-id>`.

## Solo el MCP en el plan gratuito (`render.mcp.yaml`)

El Blueprint crea un servicio web y un PostgreSQL. La web se usa para iniciar sesión y autorizar al agente. Next reenvía `/mcp` y su metadata de descubrimiento al MCP local del servicio; el broker no tiene una ruta pública. El dashboard de pruebas, Ollama y las identidades de desarrollo no se despliegan.

### Configurar el Blueprint

1. En Render abre **New → Blueprint** y elige el repo y la rama con `render.mcp.yaml`. Selecciona ese archivo como ruta del Blueprint para usar el plan gratuito en lugar del stack de `render.yaml`. Si el workspace requiere acceso de GitHub que no tienes en este repo, usa el espejo personal del README.
2. Crea un cliente OAuth de tipo **Aplicación web** en Google Cloud. Agrega como URI de redirección `https://<servicio>.onrender.com/api/auth/callback/google` con el dominio exacto asignado por Render. Si la pantalla de consentimiento está en modo de pruebas, agrega las cuentas autorizadas en Google Cloud.
3. Completa `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y tres claves Ed25519 privadas nuevas en los campos del Blueprint. Ejecuta esto una vez en una terminal privada para generar las claves (no las pegues en un chat ni las guardes en Git):

   ```sh
   node --input-type=module -e '
     import { generateKeyPairSync } from "node:crypto";
     for (const name of ["BROKER_SIGNING_KEY", "MCP_SERVICE_PRIVATE_KEY", "WEB_SERVICE_PRIVATE_KEY"]) {
       const { privateKey } = generateKeyPairSync("ed25519");
       console.log(`${name}=${JSON.stringify(privateKey.export({ format: "jwk" }))}`);
     }
   '
   ```

   Pega solo el JSON de cada JWK en su campo. Render genera los demás secretos. Conserva los valores entre despliegues: cambiar `WAKE_SECRETS_KEY` vuelve ilegibles los secretos de webhooks ya guardados.
4. Aplica el Blueprint. El servicio migra la base con el usuario del Blueprint (requiere ser dueño de la base y tener `CREATEROLE`) y usa roles separados para web y broker al atender tráfico. Sin las dos variables de Google, el servicio arranca y publica la metadata, pero no se puede iniciar sesión. Los cambios de código no despliegan automáticamente: selecciona **Manual Deploy** cuando quieras actualizar.

### Conectar y comprobar

Con el dominio real publicado, reemplaza `https://<servicio>.onrender.com` en:

```sh
curl -fsS https://<servicio>.onrender.com/healthz
curl -fsS https://<servicio>.onrender.com/.well-known/oauth-protected-resource/mcp
curl -i -X POST https://<servicio>.onrender.com/mcp

claude mcp add --transport http nexo https://<servicio>.onrender.com/mcp
```

Los primeros dos comandos devuelven `200`. El POST sin token devuelve `401` y un `WWW-Authenticate` con el enlace a la metadata OAuth. En Claude Code abre `/mcp`, autentica Nexo con Google y acepta los permisos. Otros clientes deben soportar MCP Streamable HTTP y OAuth.

El plan gratuito duerme al quedar inactivo; mientras duerme no procesa avisos ni vencimientos y la primera conexión puede demorar. Render Postgres gratuito expira después de 30 días: para mantener la instancia activa y conservar sus datos, cambia el plan antes del vencimiento.

Para habilitar texto libre en WhatsApp, configura `ANTHROPIC_API_KEY` en **Environment**
del servicio. El launcher la pasa solo al proceso web. Sin ella siguen funcionando
los comandos de la [guía de WhatsApp](whatsapp.md).
