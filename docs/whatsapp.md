# WhatsApp en Sideband

El número de WhatsApp personal se vincula a la misma cuenta que autoriza el MCP de Sideband. Kapso recibe los mensajes en **un número de Sideband**; el titular no necesita WhatsApp Business ni un agente local abierto. El broker aplica las reglas del destinatario como siempre.

## Configurar

1. En Kapso conecta el número de Sideband o usa el [sandbox](https://docs.kapso.ai/docs/how-to/whatsapp/use-sandbox-for-testing). En sandbox agrega y activa cada teléfono de prueba con el código de **Kapso** antes de vincularlo a Sideband.
2. En el entorno de **web**, configura `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID` (ID de la configuración del número), `KAPSO_WHATSAPP_NUMBER` (el número del chat con prefijo internacional y `+`) y `KAPSO_WEBHOOK_SECRET`. No compartas las llaves de servicio del MCP con Kapso. Para que las respuestas lleguen solas, configura también `WHATSAPP_NOTICE_SECRET` (`whsec_` y 32 bytes en base64; `pnpm bootstrap` lo genera en local). El broker debe poder llamar a `BETTER_AUTH_URL`: en local con `WAKE_ALLOW_INSECURE=1`.
3. Aplica `pnpm sideband:auth:migrate` y después las [migraciones de ops](admin.md).
4. Crea un webhook **del número**, no de proyecto, para `whatsapp.message.received` (formato v2, sin buffering) en `https://<origen-web>/api/kapso/webhook`. Usa el mismo secreto que en web. Para desarrollo, Kapso necesita un túnel HTTPS al puerto web del worktree. Configura únicamente este receptor para responder a esos mensajes; no necesitas crear un agente o workflow adicional en Kapso.

En el servicio que recibe el webhook, un `POST /api/kapso/webhook` sin firma debe responder `401` si Kapso quedó habilitado. Si responde `404`, verifica que el despliegue incluya la ruta y que el proceso web esté recibiendo las cuatro variables `KAPSO_*` con el formato indicado.

## Validar la respuesta localmente sin WhatsApp

1. Desde un worktree de prueba con Node 24, pnpm 10 y Docker, ejecuta `pnpm bootstrap`.
2. Levanta MCP y broker y deja abierta esa terminal.

   ```sh
   pnpm with-env env MCP_DEV_AUTH=1 pnpm exec turbo run dev --filter @team-31/mcp --filter @team-31/broker-service
   ```

3. En otra terminal del mismo worktree, ejecuta `pnpm test:whatsapp`. Debe pasar la prueba «WhatsApp recupera por estado la respuesta del segundo agente».

La prueba crea dos cuentas locales, concede el permiso de pregunta y ejecuta el mismo comando que procesa el webhook. Comprueba el estado pendiente, toma la solicitud de la bandeja MCP del destinatario, responde y verifica que tanto `estado <ID>` como `estado` devuelvan el texto exacto. Usa el broker HTTP y PostgreSQL del worktree. El vínculo telefónico y el transporte de Kapso se prueban por separado.

## Probar con dos cuentas

Para habilitar texto libre, configura `ANTHROPIC_API_KEY` en el **proceso web**. No hace falta volver a vincular los números. Sin la clave funcionan los comandos `Pregunta a …` y `estado`. Las consultas por texto libre envían el mensaje original a Claude; el número vinculado, la agenda de contactos y las respuestas del broker no se envían como contexto al modelo.

1. Con sesión iniciada, abre **Agentes → Conectar con Sideband → WhatsApp**. Genera y envía el código de **Sideband**. Vuelve a la web y confirma que el número detectado sea el tuyo.
2. Escribe `Pregunta a carla@sideband.app si puede jugar el sábado` (usa la dirección real del destinatario). Verifica el ID en **Actividad** y en `sideband_check` desde el MCP autorizado por la misma cuenta.
3. Para el caso permitido, agrega primero en la cuenta de destino un permiso de **Pregunta** para la dirección que pregunta. Responde desde el MCP de destino: la respuesta llega sola al teléfono. `estado`, `¿ya respondió?` o `estado <ID>` siguen funcionando. Sin permiso, comprueba que no se muestren datos ni el motivo de la denegación.
4. Desvincula desde web y repite `estado`. El teléfono ya no debe poder consultar esa cuenta; el MCP previamente autorizado sigue funcionando.

Con Claude habilitado, prueba «¿A mi amiga Carla le interesa la cerámica?». El flujo busca en tus amigos y pide elegir si encuentra varias coincidencias. Contesta «la segunda» para retomar el mismo turno en el vínculo verificado. «¿Y qué dijo Carla?» consulta el estado de una solicitud enviada. Si hay varias, el flujo pide identificar cuál.

Para disponibilidad, prueba «¿Está libre Carla mañana a las 15:00 por media hora?». El flujo resuelve la fecha respecto del mensaje inicial y pide los parámetros que falten. También admite descubrimiento explícito de perfiles públicos y lectura de categorías de bóveda compartidas. Un envío colectivo parcialmente confirmado se puede retomar con `continuar`. El flujo conserva los identificadores de las solicitudes ya creadas.

La confirmación del vínculo registra el canal de avisos. Si falla el registro, el siguiente mensaje vuelve a intentarlo. Cuando una solicitud espera aprobación o termina, el broker avisa a web. Fuera de la ventana de 24 horas de WhatsApp, la respuesta queda pendiente hasta el siguiente mensaje del titular. Para mensajes en lenguaje natural procesados por el grafo, web confirma el webhook después de entregar el resultado. Si hay un fallo transitorio, el proveedor puede repetir el mismo identificador de entrega. El broker deduplica los envíos del turno. Si Kapso aceptó una respuesta al teléfono y se perdió el acuse, el texto de esa respuesta puede llegar otra vez. [Flujo conversacional](./message-routing.md)

## Probar con el elenco de cinco contactos

El elenco son cinco titulares ficticios (Carla, Benja, Sofía, Tomás y Valentina) definidos en `apps/demo/src/cast.json`. Cada uno tiene un perfil público, disponibilidad por día, intereses, una bóveda «Salud» y lo que te comparte. Su agente corre en web: recibe el aviso firmado en `/api/demo/cast-wake/<id>` y responde con `createOwnerRuntime`. `interest_check` lo resuelve Claude Code con la misma tool verificada que Contactos de Ana; `availability` se calcula de los bloques libres. La salud no pasa por el agente: el broker la lee de la bóveda solo si el contacto te la comparte.

1. Con el stack local arriba y tu dirección reclamada en web, ejecuta `pnpm agents:cast:seed tu-direccion@sideband.app`. Repetirlo restaura los datos y lo que comparte cada contacto.
2. Abre `/demo/elenco` en el puerto web del worktree. Muestra lo público, lo privado y quién puede pedir cada dato, leído del broker.
3. Desde WhatsApp prueba «¿A alguien de mis contactos le interesa el fútbol?», «¿Quién de mis contactos está libre el sábado a las 11 por una hora?» o «¿Qué tiene guardado Sofía en Salud?».
