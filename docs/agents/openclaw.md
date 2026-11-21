# Conectar OpenClaw a Sideband

1. **Agregar el servidor.** En `openclaw.json`, agrega el objeto `sideband` a `mcp.servers`. Reemplaza `<MCP_RESOURCE_URL>` por el valor del worktree. Conserva las otras entradas de `mcp.servers`. [Transportes y OAuth de OpenClaw](https://docs.openclaw.ai/cli/mcp/transports)

   ```json
   {
     "mcp": {
       "servers": {
         "sideband": {
           "url": "<MCP_RESOURCE_URL>",
           "transport": "streamable-http",
           "auth": "oauth"
         }
       }
     }
   }
   ```

2. **Autorizar.** Con el Gateway en ejecución, corre el comando, abre el enlace y autoriza al cliente en Sideband. Copia el [bloque de confianza](trust-snippet.md) al `AGENTS.md` del agente. [Login MCP de OpenClaw](https://docs.openclaw.ai/cli/mcp/transports#oauth-workflow)

   ```sh
   openclaw mcp login sideband
   ```

3. **Configurar el aviso.** En `openclaw.json` habilita `hooks.enabled`, guarda un `hooks.token` generado para ese Gateway y agrega el agente elegido a `hooks.allowedAgentIds`. En Sideband, abre **Agentes → Conectar → OpenClaw**, agrega el origen del Gateway y el token de hook. Sideband añade `/hooks/agent` y manda `Idempotency-Key` con el ID de la solicitud y `deliver: false`. [Hooks y reintentos de OpenClaw](https://docs.openclaw.ai/gateway/config-hooks)

   ```sh
   openssl rand -base64 32
   ```

4. **Probar.** Pulsa **Probar** en Sideband. La respuesta `200` de `/hooks/agent` normalmente confirma la admisión de la corrida y trae `runId`. Verifica el cierre de la solicitud en Sideband. El plan de Sideband registra un aviso en menos de 1 s y una respuesta en aproximadamente 10 s en el POC. Los tiempos actuales de una cuenta OpenClaw están **sin verificar**. [Respuesta de los hooks](https://docs.openclaw.ai/gateway/config-hooks#endpoints)

## Calendario

Si el dueño autoriza usar Google Calendar, configura `gog` con acceso de lectura y usa su operación de disponibilidad. Configura el agente para devolver solo `available` y, si la regla lo permite, `freeSlots`. Revisa la concesión en la pantalla de Google al autorizar la cuenta. [Guía de gog](https://gogcli.sh/) · [Skills de OpenClaw](https://docs.openclaw.ai/tools/skills)

## Problemas comunes

- **El receptor queda fuera del alcance del broker.** Para el ensayo local, usa un receptor de loopback en un worktree aislado. Si posteriormente conectas un Gateway fuera del equipo local, un origen HTTPS alcanzable puede obtenerse con Tailscale Funnel o un túnel HTTPS, según tu configuración. [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) · [Hooks de OpenClaw](https://docs.openclaw.ai/gateway/config-hooks)
- **El Gateway rechaza el aviso.** Comprueba `hooks.enabled`, el token guardado y que `hooks.allowedAgentIds` incluya el ID del agente que usa Sideband. [Configuración de hooks](https://docs.openclaw.ai/gateway/config-hooks)
