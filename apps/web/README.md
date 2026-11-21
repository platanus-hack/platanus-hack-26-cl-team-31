# App Nexo

## Inicio local

Desde la raíz, con el entorno del worktree inicializado:

1. Configura `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `MCP_RESOURCE_URL` en `.env.local`. Genera un secreto con `openssl rand -base64 32`. En Google OAuth registra el origen `BETTER_AUTH_URL` del worktree y la URI de retorno `${BETTER_AUTH_URL}/api/auth/callback/google`.
2. Si el broker está disponible, configura `BROKER_URL` y `WEB_SERVICE_PRIVATE_KEY`. Web consulta la dirección del usuario mediante `OwnerPort.me`. La conexión del agente se registra en el broker al recibir su primera llamada autenticada, con `wakeKind: "none"`.
3. Ejecuta estos comandos.

```bash
pnpm build --filter './packages/*'
pnpm with-env pnpm --filter @team-31/web auth:migrate
pnpm dev --filter @team-31/web
```

Abre `${BETTER_AUTH_URL}/sign-in`. Después de iniciar sesión directamente con Google, los usuarios sin dirección pasan a `/onboarding` (NX-12).

## OAuth para agentes

La metadata se publica en `/.well-known/oauth-authorization-server` y en `/.well-known/oauth-authorization-server/api/auth` para los clientes que la solicitan desde el issuer. Incluye los endpoints de autorización, token, registro dinámico de clientes y JWKS. Inicia la conexión desde tu cliente OAuth para solicitar consentimiento con los permisos de Nexo.
