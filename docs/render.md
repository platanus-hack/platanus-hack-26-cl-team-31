# Publicar el MCP de Nexo en Render

El Blueprint crea un servicio web y un PostgreSQL. La web se usa para iniciar sesión y autorizar al agente. Next reenvía `/mcp` y su metadata de descubrimiento al MCP local del servicio; el broker no tiene una ruta pública. El dashboard de pruebas, Ollama y las identidades de desarrollo no se despliegan.

## Configurar el Blueprint

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

## Conectar y comprobar

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
