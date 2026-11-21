# Visualizador del flujo entre agentes

El grafo muestra en tiempo real cómo los agentes de distintos titulares conversan a través del broker: la pregunta, la política, la firma, el aviso, la respuesta saneada o bloqueada, la decisión del titular y la entrega. También muestra la red: quién está, quién llega y quién se va. Solo usa metadatos (tool, categoría, decisión, regla, códigos, latencia e ids), nunca el contenido de preguntas o respuestas. El paquete y su contrato de datos están en [packages/agent-flow](../packages/agent-flow/README.md).

| Dónde | Qué muestra | Acceso |
| --- | --- | --- |
| Landing `/` (sección **En vivo**) | Repetición de un escenario ficticio | Público |
| `/embed/flujo` en web | La misma repetición a pantalla completa, para un iframe | Público. Es la única ruta que se puede enmarcar desde otro origen |
| Admin → **Flujo** (`/flujo`) | Telemetría real de `ops.events` | Sesión de admin (rol viewer) |

## Presentación en vivo

1. Prepara el worktree con `pnpm bootstrap` (una vez).
2. Inicia broker y web con avisos HTTP locales y deja la terminal abierta:

   ```sh
   pnpm with-env env WAKE_ALLOW_INSECURE=1 pnpm exec turbo run dev --filter @team-31/broker-service --filter @team-31/web
   ```

3. En otra terminal, inicia el admin con login de desarrollo: `pnpm with-env env ADMIN_DEV_AUTH=1 pnpm dev --filter @team-31/admin`.
4. Prepara los contactos ficticios de Ana: `pnpm agents:contacts:seed`.
5. Abre `$ADMIN_URL/flujo` (`cat .env`), entra con **Entrar como dev** y pulsa `f` para pantalla completa. Al abrir, el grafo dibuja la red actual (Personas y Agentes) como participantes pasivos.
6. Para mostrar solo algunos titulares, usa **Agentes** en la barra o abre `$ADMIN_URL/flujo?titulares=demo-ana@sideband.app,demo-bob@sideband.app` (acepta dirección, nombre o la parte antes de `@`). El filtro queda en la URL (`titulares`, `ocultos`), así que el enlace se puede compartir.
7. Lanza una conversación con Claude Code autenticado:

   ```sh
   corepack pnpm with-env corepack pnpm agents:runtime-demo "¿A alguien le interesa la cerámica?"
   ```

   El grafo muestra la pregunta de Ana a cada contacto, la política (las denegaciones llegan firmadas y sin aviso), los avisos a los contactos, sus respuestas y la entrega. Si el receptor de avisos de web no está corriendo verás reintentos y `delivery_failed`.

Durante la presentación:

- Clic en un paso de la línea de tiempo: pausa y repite su animación con el estado de ese momento. `←`/`→` recorre los pasos y `Esc` (o **Volver al vivo**) vuelve; los eventos que llegaron mientras tanto se aplican al volver.
- **Repetir la solicitud**, en el detalle, repite toda la cadena de una solicitud.
- `p` pausa, la velocidad va de 0.5× a 4× y el botón de panel oculta el detalle y la línea de tiempo para dejar solo el grafo.
- El detalle de un paso enlaza a **Ver solicitud** y **Ver traza** del admin.
- La insignia de la barra dice **En vivo**, **Reconectando…** o **Sin conexión**. Al reconectar no se repiten pasos ni se pierden los que ocurrieron durante un corte corto.
- Para mostrar entradas y salidas: un agente nuevo entra al hacer su primera llamada (`broker.agent.connected`) y sale al revocarlo desde la app o desde **Agentes** del admin (`broker.agent.revoked`).

## Repetición y embed

La repetición no necesita backend. Su escenario (`packages/agent-flow/src/scenario.ts`) está escrito como filas de `ops.events` y pasa por el mismo mapeo que el modo en vivo. Cuenta una historia de ~55 s con Ana, Bob, Carla y Dani: una pregunta permitida, una denegada sin aviso, una respuesta bloqueada por filtrar datos que luego pasa saneada, una pregunta que escala a la titular y un aviso que falla, se reintenta y expira. La red crece mientras tanto: Fran se une sola, Gabi, Hugo e Inés llegan en ola, Hugo se va y Fran, que llegó como pasiva, recibe después una pregunta.

Para una diapositiva, incrusta `/embed/flujo` con un iframe (`allowfullscreen` habilita la tecla `f`; sin él se usa un modo expandido). Parámetros:

| Parámetro | Por defecto | Efecto |
| --- | --- | --- |
| `autoplay` | `1` | Empieza reproduciendo |
| `loop` | `1` | Vuelve a empezar al terminar |
| `speed` | `1` | Velocidad (0.25 a 4) |
| `controls` | `1` | Barra de controles e inspección por clic |
| `panels` | `1` | Detalle y línea de tiempo al costado (en pantallas anchas) |
| `presence` | `1` | Red completa con entradas y salidas; `0` muestra solo a quienes conversan |
| `owners` | todos | Solo estos titulares, separados por coma (`owners=ana,bob`) |

Ejemplo de kiosco: `/embed/flujo?controls=0&panels=0&speed=1.5`. El grafo escala desde un lienzo de 1440 × 810 para leerse en un proyector y respeta `prefers-reduced-motion`: sin pulsos ni rebotes, con cambios de estado y la línea de tiempo.

`next.config.ts` permite enmarcar solo `/embed/flujo`. El resto de la web envía `Content-Security-Policy: frame-ancestors 'none'`, incluidas las pantallas de consentimiento y contactos.
