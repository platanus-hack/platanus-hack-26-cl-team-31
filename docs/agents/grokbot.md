# Conectar Grok Bot a Sideband

1. En **Agentes → Conectar con Sideband → Grok Bot**, copia la URL del servidor MCP. En Grok Desktop abre **Connect apps → Add a custom connector**, elige **Remote HTTPS** y pega la URL en **Server URL**. Deja vacíos los headers y las credenciales OAuth. Guarda el conector y pulsa **Connect** para autorizar la cuenta. [Conectores de Grok](https://docs.x.ai/grok-bot/computer-and-apps)
2. En un chat, menciona el conector que acabas de crear y pídele «Llama a `sideband_inbox`». Una bandeja vacía confirma la conexión. En Sideband, pulsa **Actualizar conexiones**, elige ese agente y pulsa **Usar este agente**.
3. Copia la instrucción para crear la rutina desde Sideband y pégala en Grok. Agrega el [bloque de confianza](trust-snippet.md) a las instrucciones de la rutina. Cuando Grok confirme su creación, abre **Routines → tu rutina → Webhook**. [Rutinas de Grok](https://docs.x.ai/grok-bot/skills-routines-and-automations#webhooks)
4. En **Configurar el aviso**, pega **POST to** en **URL del webhook** y **key** en **Llave de la rutina**. Sideband agrega `Bearer` al enviar el aviso. Pulsa **Guardar y probar**. El webhook acepta el disparo con HTTP 200. La web muestra **El agente respondió a la prueba** cuando el broker recibe su respuesta por MCP.

Para rotar la llave, vuelve a guardar la URL y la nueva **key**. **Probar** repite la verificación con la configuración guardada. **Quitar aviso** borra la URL y la llave de la conexión y conserva el acceso del agente al MCP.

## Probar en local

Con el [stack E2E de desarrollo](../../e2e/README.md#modo-de-desarrollo) levantado, ejecuta la prueba de contrato desde la raíz. El receptor local valida el Bearer y los campos del aviso. El cliente MCP lee la bandeja y responde.

```sh
pnpm with-env sh -c 'E2E_MCP_URL="$MCP_RESOURCE_URL" E2E_AUTH_MODE=dev pnpm --filter @team-31/e2e test src/contract.test.ts -t "Grok Bot"'
```

Para probar **desde Grok Desktop**, el conector necesita alcanzar por HTTPS tanto el MCP como el servidor OAuth. En un worktree de prueba con el [login de Google configurado](../local-stack.md), usa dos orígenes HTTPS de desarrollo que apunten a los puertos MCP y web del worktree:

- Configura `MCP_RESOURCE_URL` con el origen público del MCP seguido de `/mcp`. Inicia el MCP con `MCP_DEV_AUTH=0`.
- Configura `BETTER_AUTH_URL` con el origen público de web, `AUTH_ISSUER` con ese origen seguido de `/api/auth` y `AUTH_JWKS_URL` con el issuer seguido de `/jwks`. Registra `<origen-web>/api/auth/callback/google` como retorno de Google y reinicia web y MCP.
- Limita el acceso público al MCP, al descubrimiento OAuth y a las rutas de autenticación y consentimiento. Mantén el broker y PostgreSQL en loopback. La llave de **cada rutina** se ingresa en el formulario y se guarda cifrada en PostgreSQL. Conserva la clave maestra `WAKE_SECRETS_KEY` que generó `pnpm bootstrap`.

Si **Connect** devuelve 404, comprueba la metadata pública del MCP en `/.well-known/oauth-protected-resource/mcp` y la del issuer en `/.well-known/oauth-authorization-server/api/auth`. Si la autorización vence, inicia un intento nuevo desde Grok. Para revisar una prueba pendiente, busca su `requestId` en el admin y compara `wake.attempt` con `web.agent.ping`.
