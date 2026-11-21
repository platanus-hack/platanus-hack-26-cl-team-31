# Conectar Grok Bot a Nexo

1. **Agregar el conector.** En la app de escritorio de Grok Bot, abre **Connect apps**, baja a **Add a custom connector** y selecciona **Remote HTTPS**. Ingresa `Nexo` como nombre y tu `MCP_RESOURCE_URL` como **Server URL**. La pantalla admite un **OAuth Client ID** y muestra **Client Secret** cuando lo ingresas. La interoperabilidad de Nexo con el registro automático en Grok Bot está **sin verificar**. [Conectores de Grok Bot](https://docs.x.ai/grok-bot/computer-and-apps)
2. **Autorizar.** Si se abre Nexo, entra con tu cuenta y revisa la pantalla `/consent`. Agrega el [bloque de confianza](trust-snippet.md) a las instrucciones de la rutina. Si el conector pide credenciales adicionales, revisa su configuración de OAuth. [Ayuda de conexiones de Grok Bot](https://docs.x.ai/grok-bot/troubleshooting)
3. **Configurar la rutina.** Pídele al Bot que cree una rutina con disparador por webhook. En escritorio abre su detalle y busca la sección **Webhook**. Copia su URL y su llave a **Configurar aviso** en Nexo. La autenticación del disparador usa `Authorization: Bearer <key>`. [Rutinas y webhooks](https://docs.x.ai/grok-bot/skills-routines-and-automations#webhooks)

   ```text
   Crea una rutina de webhook para Nexo. Cuando se dispare, consulta nexo_inbox y responde según el bloque de confianza que configuré.
   ```

4. **Probar.** Selecciona **Probar** en Nexo y observa si la rutina aparece en el historial de Grok Bot. El webhook devuelve `200` al aceptar el disparo. Confirma el cierre de la solicitud en Nexo. [Verificación de rutinas](https://docs.x.ai/grok-bot/skills-routines-and-automations)

## Problemas comunes

- **No aparece el conector personalizado o falla el OAuth.** Para la demo local usa un cliente de la [guía de Claude Code y Codex](claude-code-codex.md). El paso por Grok Bot con Nexo requiere un ensayo en la cuenta que presentará la demo. [Ayuda de conexiones de Grok Bot](https://docs.x.ai/grok-bot/troubleshooting)
- **La rutina no arranca.** Revisa en su pantalla el historial, la URL y si guardaste la llave vigente. La documentación indica un máximo de 300 ejecuciones por hora para todas las rutinas y 200 por hora por rutina. [Límites de rutinas](https://docs.x.ai/grok-bot/skills-routines-and-automations#rate-limits)
