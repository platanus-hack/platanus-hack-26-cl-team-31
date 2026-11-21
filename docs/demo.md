# Demo de Nexo en tres minutos

Simon configura quién puede consultar su agenda. Una persona del equipo recibe disponibilidad y bloques libres, una desconocida necesita su aprobación, y las solicitudes reciben un cierre aunque se apague el receptor.

## Preparación local

Usa Node 24, pnpm 10 y Docker en un worktree dedicado. Los [pasos de instalación del stack](local-stack.md) explican cómo se asignan los puertos del worktree. Detén sus procesos de desarrollo antes de iniciar los de la demo.

En la primera terminal ejecuta estos comandos y deja el stack abierto.

```sh
pnpm bootstrap
pnpm with-env node scripts/demo/nexo.mjs init
pnpm with-env node scripts/demo/nexo.mjs stack
```

Espera los mensajes de arranque de Next.js, el broker y MCP. Ejecuta estos comandos en otra terminal.

```sh
pnpm with-env node scripts/demo/nexo.mjs seed
pnpm with-env node scripts/demo/nexo.mjs run --present
```

Abre el enlace de un solo uso en una ventana privada antes de compartir pantalla. La sesión lleva a **El cable**. Abre **Inicio**, **Reglas** y **Agentes** en pestañas del mismo navegador. El guion muestra cuándo actuar y pulsar Enter. Para una prueba desatendida, usa `run` sin `--present`. El comando valida los resultados de MCP y realiza las acciones de dueño por el cliente HTTP del broker.

Las cuatro cuentas, los cinco clientes MCP y la agenda son fixtures locales. Dot, Grok Bot y Claude Code representan a tres compañeros. Simon tiene un OpenClaw principal con calendario ficticio y una segunda conexión para la revocación. Better Auth registra los clientes y emite sus tokens mediante OAuth con PKCE. El MCP valida los tokens con los JWKS de la app. El aviso principal cruza HTTP con el formato de OpenClaw. El receptor solo obtiene el identificador y busca los argumentos en `nexo_inbox`.

## Guion para presentar

| Tiempo | Acción y evidencia | Plan B |
| --- | --- | --- |
| 0:00–0:20 | Presenta a Simon y a los tres compañeros conectados. Muestra **En vivo** en El cable. | Si una cuenta real requiere reconexión, usa las cuentas locales preparadas. Si el stream demora, abre **Actividad** y actualiza tras cada paso. |
| 0:20–0:55 | «Pregúntale a Simon si puede el lunes a las 11». La terminal envía la consulta de Dot. Muestra el aviso y el cierre en El cable. Dot recibe `available: false` y los bloques `12:00-12:30` y `15:00-15:30`. | Si Dot demora con MCP Events o pide confirmación, usa Claude Code con el watcher. Si falla el túnel, usa un OpenClaw en un servidor accesible. Para el ensayo local, ejecuta con el receptor de loopback. |
| 0:55–1:30 | Claude Code pregunta lo mismo como desconocido. Muestra **Por revisar** en El cable. En **Inicio**, actualiza y elige **Aprobar una vez**. El agente recibe solo `available: false`. La siguiente pregunta vuelve a esperar al dueño. | Si la acción en la app falla, escribe `api` en la pausa de la terminal y pulsa Enter para aprobar esa solicitud por el puerto del dueño. |
| 1:30–2:00 | En **Reglas**, pega la dirección de Grok Bot que muestra la terminal en **Personas bloqueadas**. Pulsa **Bloquear** y **Guardar reglas**. Su siguiente intento devuelve `deny` firmado, sin motivo ni datos. | Si el formulario falla, escribe `api` en la pausa para guardar el bloqueo y ejecutar la misma consulta. |
| 2:00–2:25 | En **Agentes**, ubica el identificador del OpenClaw secundario que imprime la terminal. Pulsa **Desconectar** y confirma. El mismo cliente llama a `nexo_inbox` y recibe `not_found`. | Si el formulario falla, escribe `api` en la pausa para revocar esa conexión. |
| 2:25–3:00 | La terminal apaga el receptor principal y Dot pregunta otra vez. El worker del broker agota los reintentos. Muestra **Error de entrega** en El cable y `delivery_failed`, `final: true` y la comprobación de firma en la terminal. | Si el aviso se acepta y el bot queda sin responder en una presentación con agentes reales, mantén el seguimiento hasta que el plazo termine en `expired`. Con el receptor local apagado se puede enseñar el fallo de entrega en pocos segundos. |

Las guías de conexión describen [Dot y MCP Events](agents/dot.md), [Grok Bot](agents/grokbot.md), [OpenClaw](agents/openclaw.md) y [Claude Code con el watcher](agents/claude-code-codex.md).

## Reinicio

Cierra la ventana privada y detén el stack de la demo con Ctrl+C. Ejecuta `pnpm with-env node scripts/demo/nexo.mjs reset`. Este comando elimina la base descartable `app_nx19_<id>` que creó `init` y verifica su marca antes de borrarla. Las bases `app` y `app_test` conservan sus datos. Para repetir, ejecuta `init`, `stack`, `seed` y `run --present` en ese orden.

## Ensayos

Los dos ensayos del 21 de noviembre de 2026 usaron Node 24, pnpm 10 y el stack local de Next.js, broker, MCP y PostgreSQL. Chrome, controlado con Playwright, comprobó la sesión y el stream SSE de El cable. En ambos ensayos se pulsaron los controles reales de Inicio, Reglas y Agentes. La preparación incluye los intercambios OAuth y la apertura de las pestañas. Los pasos en vivo miden la ejecución con el navegador automatizado. El guion de tres minutos reserva tiempo para narrar y operar los controles en una presentación.

| Paso | Clientes o receptores de ambos ensayos | Ensayo 1 | Ensayo 2 |
| --- | --- | ---: | ---: |
| 1. Conexión y vista en vivo | Cinco clientes locales del SDK de MCP con OAuth PKCE, sesión de Simon y Chrome | 2,92 s | 2,28 s |
| 2. Consulta permitida de disponibilidad | Dot local, receptor OpenClaw de loopback, agenda ficticia y El cable | 1,57 s | 0,61 s |
| 3. Aprobación por única vez | Claude Code local, receptor OpenClaw de loopback y botón de Inicio | 2,27 s | 2,68 s |
| 4. Bloqueo por dirección | Grok Bot local y formulario de Reglas | 0,32 s | 0,19 s |
| 5. Revocación y llamada rechazada | OpenClaw secundario local, con el mismo acceso OAuth, y controles de Agentes | 0,27 s | 0,16 s |
| 6. Cierre con receptor apagado | Dot local, receptor OpenClaw detenido, worker del broker y El cable | 3,21 s | 3,42 s |
| **Total en vivo (pasos 2–6)** | | **7,64 s** | **7,07 s** |

En ambos ensayos, el último resultado fue `delivery_failed` con `final: true` y la firma del broker. El reinicio entre ensayos eliminó la base de la primera corrida. Tras el último reinicio, PostgreSQL conservaba `app` y `app_test`.
