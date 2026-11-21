# WhatsApp en Sideband

El número de WhatsApp personal se vincula a la misma cuenta que autoriza el MCP de Sideband. Kapso recibe los mensajes en **un número de Sideband**; el titular no necesita WhatsApp Business ni un agente local abierto. El broker aplica las reglas del destinatario como siempre.

## Configurar

1. En Kapso conecta el número de Sideband o usa el [sandbox](https://docs.kapso.ai/docs/how-to/whatsapp/use-sandbox-for-testing). En sandbox agrega y activa cada teléfono de prueba con el código de **Kapso** antes de vincularlo a Sideband.
2. En el entorno de **web**, configura `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID` (ID de la configuración del número), `KAPSO_WHATSAPP_NUMBER` (el número del chat con prefijo internacional y `+`) y `KAPSO_WEBHOOK_SECRET`. No compartas las llaves de servicio del MCP con Kapso.
3. Aplica `pnpm sideband:auth:migrate` y después las [migraciones de ops](admin.md). En Render, el predeploy de web aplica la migración de auth y WhatsApp; si habilitas el canal, despliega también el broker actualizado.
4. Crea un webhook **del número**, no de proyecto, para `whatsapp.message.received` (formato v2, sin buffering) en `https://<origen-web>/api/kapso/webhook`. Usa el mismo secreto que en web. Para desarrollo, Kapso necesita un túnel HTTPS al puerto web del worktree. Configura únicamente este receptor para responder a esos mensajes; no necesitas crear un agente o workflow adicional en Kapso.

En despliegues con un rol web separado (`nexo_web_runtime`), provisiona el rol antes de `auth:migrate` o vuelve a ejecutar la migración después de crearlo. En el servicio que recibe el webhook, un `POST /api/kapso/webhook` sin firma debe responder `401` si Kapso quedó habilitado. Si responde `404`, verifica que el despliegue incluya la ruta y que el proceso web esté recibiendo las cuatro variables `KAPSO_*` con el formato indicado.

## Probar con dos cuentas

1. Con sesión iniciada, abre **Agentes → Conectar con Sideband → WhatsApp**. Genera y envía el código de **Sideband**. Vuelve a la web y confirma que el número detectado sea el tuyo.
2. Escribe `Pregunta a carla@sideband.app si puede jugar el sábado` (usa la dirección real del destinatario). Verifica el ID en **Actividad** y en `sideband_check` desde el MCP autorizado por la misma cuenta.
3. Para el caso permitido, agrega primero en la cuenta de destino un permiso de **Pregunta** para la dirección que pregunta. Responde desde el MCP de destino y escribe `estado`, `¿ya respondió?` o `estado <ID>` en el teléfono para ver la respuesta. Sin permiso, comprueba que no se muestren datos ni el motivo de la denegación.
4. Desvincula desde web y repite `estado`. El teléfono ya no debe poder consultar esa cuenta; el MCP previamente autorizado sigue funcionando.

El MVP admite mensajes de texto para enviar preguntas y consultar solicitudes, no un chat con memoria, adjuntos o notificaciones proactivas. Los duplicados de Kapso no vuelven a ejecutar la consulta. El envío de la respuesta es de mejor esfuerzo en segundo plano: si falla o el proceso se reinicia, pide `estado` antes de reenviar una pregunta.
