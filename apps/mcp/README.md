# Coordinar asistentes en local

## Probar dos identidades

Desde la raíz del repo, con Docker corriendo, usa Node 24 y pnpm 10. Si usas nvm, ejecuta `nvm use` y `corepack enable pnpm` una vez.

1. En una terminal, ejecuta `pnpm agents:up 2` y espera «Coordinación lista en puerto …». Déjala abierta.
2. En otra terminal, ejecuta `pnpm agents:demo 2`. El guion conecta clientes MCP por stdio y chequea las respuestas. Funciona sin cuenta de un proveedor de IA.
3. Para sumar a Carla con la API abierta, ejecuta `pnpm agents:seed 3` y luego `pnpm agents:demo 3`. Para N mayor se crean `agente4`, `agente5`, etc.

Puedes editar las personas, sus permisos iniciales y los bloques ocupados en [los datos de la demo](../../scripts/coordination-fixture.mjs).

El sábado ficticio es el **28 de noviembre de 2026**. Ana ve a Bob ocupado a las 16:00 y disponible a las 18:00 de Santiago. Eva, externa al grupo `futbol`, recibe `not_shareable`. El guion publica y retira un interés, revoca y restablece el permiso de Bob, y prueba las bandejas por persona. La última aceptación confirma el encuentro y muestra su ID. Cada corrida crea una propuesta nueva en PostgreSQL.

## Hablar con Ana y Bob en Claude Code

Con la API abierta, inicia estos comandos en **dos terminales distintas** desde la raíz. Cada sesión carga una sola identidad y usa las herramientas del MCP de coordinación. Claude Code requiere su propia sesión iniciada.

```sh
# Terminal de Ana
claude --strict-mcp-config --mcp-config .agents-local/ana.json --tools ""

# Terminal de Bob
claude --strict-mcp-config --mcp-config .agents-local/bob.json --tools ""
```

1. **Ana** — «Pregunta si Bob está libre el 28 de noviembre a las 18:00 de Santiago durante una hora en el grupo futbol».
2. **Bob** — «Desactiva mi permiso de compartir disponibilidad con el grupo futbol». Repite la consulta desde Ana para ver la denegación.
3. **Bob** — «Reactiva mi permiso». **Ana** — «Propón a Bob jugar el 28 de noviembre a las 16:00 o 18:00 de Santiago, por una hora, en futbol».
4. **Bob** — «Revisa mi bandeja y responde la propuesta usando mi agenda». **Ana y Bob**, cada uno en su sesión — «Acepto el horario propuesto». Consulta ese encuentro desde Ana para ver el estado `confirmed`.

La bandeja se consulta cuando activas la sesión. Los agentes comparten una API HTTP que verifica la credencial, y el broker comprueba membresía y permisos antes de leer disponibilidad y entregar el resultado. La decisión de asistir se registra por participante. Los archivos de configuración son privados del usuario local y dan acceso a la identidad que contienen.

## Herramientas

| Acción | Herramientas |
|---|---|
| Disponibilidad y relectura | `availability_check`, `request_get` |
| Permisos y membresía del titular | `group_permission`, `group_leave` |
| Publicación con audiencia | `interest_publish`, `interest_search`, `interest_withdraw` |
| Propuesta y bandeja | `meeting_propose`, `meeting_inbox`, `meeting_respond` |
| Estado y consentimiento | `meeting_get`, `meeting_decide` |

Puedes escribir los nombres de participantes como `Bob` o `bob`. Sólo se entrega la proyección de disponibilidad. La agenda ficticia y los hashes de las credenciales se guardan en la base del worktree. Volver a correr el seed conserva permisos revocados y salidas del grupo.

El MCP original de diagnóstico sigue disponible con `pnpm --filter @team-31/mcp inspect` cuando se inicia sin las dos variables de coordinación.
