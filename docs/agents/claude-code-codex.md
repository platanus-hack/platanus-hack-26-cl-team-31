# Probar Sideband con Claude Code y Codex

1. **Obtener la URL.** Con el stack local de Sideband arriba, consulta el valor que generó el worktree.

   ```sh
   MCP_RESOURCE_URL="$(pnpm --silent with-env printenv MCP_RESOURCE_URL)"
   ```

2. **Agregar el servidor.** Usa la misma terminal. En Claude Code se usa Streamable HTTP y la opción de login abre el navegador. En Codex, registra el servidor por URL y ejecuta el login del conector. [MCP en Claude Code](https://code.claude.com/docs/en/mcp) · [MCP en Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

   ```sh
   claude mcp add --transport http sideband "$MCP_RESOURCE_URL"
   claude mcp login sideband
   ```

   ```sh
   codex mcp add sideband --url "$MCP_RESOURCE_URL"
   codex mcp login sideband
   ```

3. **Autorizar.** Usa el navegador para revisar la pantalla `/consent` de Sideband. Comprueba en el cliente que aparecen `sideband_ask`, `sideband_inbox`, `sideband_reply` y `sideband_check`. En Claude Code puedes consultar `/mcp` para ver el estado de los servidores. [Autenticación de Claude Code](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers) · [Login de Codex](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
4. **Revisar la bandeja.** Copia el [bloque de confianza](trust-snippet.md) en las instrucciones del agente. Para un ensayo manual, pide revisar `sideband_inbox` cuando aparezca una solicitud. El watcher del [POC](../poc/sideband-watch.mjs) es un iterador que detecta IDs nuevos. Quien lo usa elige cuándo responder al aviso.

   Si reutilizas ese watcher con el contrato actual, adapta los nombres de sus campos. `callSideband` es la función del cliente de prueba que invoca una tool.

   ```js
   import { watchInbox } from "./docs/poc/sideband-watch.mjs";

   const notices = watchInbox(async () => {
     const { items } = await callSideband("sideband_inbox", {});
     return { solicitudes: items.map(({ requestId }) => ({ request_id: requestId })) };
   });
   ```

## Problemas comunes

- **Pide iniciar sesión nuevamente.** Repite el comando `mcp login` de tu cliente. Si el problema aparece en una cuenta distinta, comprueba sus permisos en `/consent`. [Login de Claude Code](https://code.claude.com/docs/en/mcp#authenticate-from-the-command-line) · [Login de Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- **El código local enumera las tools anteriores.** Comprueba la URL obtenida de `MCP_RESOURCE_URL` y vuelve a agregar el servidor remoto HTTP con los comandos del paso 2.
