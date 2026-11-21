# Conectar un Dot a Nexo

Para la integración con un Dot, prepara una URL HTTPS de MCP que ChatGPT pueda alcanzar. Para ensayar con el stack local usa la [guía de Claude Code y Codex](claude-code-codex.md). [Requisitos de un servidor MCP personalizado](https://developers.openai.com/api/docs/guides/custom-mcp-server)

1. **Agregar Nexo.** En ChatGPT Plugins, selecciona el botón `+` y **Add custom MCP server**. Usa `Nexo` como nombre, ingresa el valor de `MCP_RESOURCE_URL`, selecciona OAuth y guarda. La pantalla de prueba permite verificar qué tools publica el servidor. [Quickstart de Plugins](https://developers.openai.com/plugins/quickstart)
2. **Autorizar.** En la ventana de conexión, inicia sesión en Nexo y revisa los permisos del cliente en `/consent`. Selecciona **Autorizar** para volver a ChatGPT. Para conectar el plugin al Dot, abre su personalización, entra a **Plugins** y agrega Nexo. [Conectar servidores MCP personalizados](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) · [Primeros pasos con un Dot](https://learn.chatgpt.com/docs/dots/getting-started)
3. **Suscribir el aviso.** Copia el [bloque de confianza](trust-snippet.md) en las instrucciones del Dot. Pídele que se suscriba a `nexo.request.created`. ChatGPT registra el callback y Nexo lo verifica antes de enviar avisos. [MCP Events](https://developers.openai.com/plugins/build/mcp-events)

   ```text
   Suscríbete al evento nexo.request.created de Nexo. Cuando llegue un aviso, consulta nexo_inbox y responde según el bloque de confianza que configuré.
   ```

4. **Probar.** Cuando aparezca la conexión en Nexo, selecciona **Probar**. Pídele al Dot que revise `nexo_inbox`. Comprueba en Nexo que la solicitud de prueba finaliza.

## Problemas comunes

- **El aviso inicia el Dot y falta el ID en la corrida.** Hay un reporte abierto para el campo `data`. La instrucción para el Dot debe indicarle que consulte toda su bandeja y tome los IDs desde `nexo_inbox`. [Reporte de MCP Events](https://github.com/openai/codex/issues/50714)
- **Se pierde la conexión.** Si faltó `offline_access`, vuelve a autorizar. ChatGPT puede necesitar un refresh token para mantener la conexión. [OAuth de servidores MCP personalizados](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
- **El evento se demora.** Usa una tarea programada con la instrucción «Consulta mi bandeja de Nexo y responde según el bloque de confianza». La disponibilidad del plugin en esa tarea y la ejecución de `nexo_reply` sin confirmación están **sin verificar**. Durante el ensayo local, revisa la bandeja con Claude Code o Codex. [Tareas en ChatGPT](https://help.openai.com/en/articles/10291617-tasks-in-chatgpt) · [Guía local](claude-code-codex.md)
