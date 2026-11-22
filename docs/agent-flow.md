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
6. Para mostrar solo algunos titulares, abre **Personas** en el mapa o abre `$ADMIN_URL/flujo?titulares=demo-ana@sideband.app,demo-bob@sideband.app` (acepta dirección, nombre o la parte antes de `@`). El filtro queda en la URL (`titulares`), así que el enlace se puede compartir.
7. Lanza una conversación con Claude Code autenticado:

   ```sh
   corepack pnpm with-env corepack pnpm agents:runtime-demo "¿A alguien le interesa la cerámica?"
   ```

   El grafo muestra la pregunta de Ana a cada contacto, la política (las denegaciones llegan firmadas y sin aviso), los avisos a los contactos, sus respuestas y la entrega. Si el receptor de avisos de web está apagado, el pie del mapa indica que el aviso no llegó.

Las tarjetas muestran el nombre de cada persona y el agente conectado. Los sobres viajan entre las tarjetas y Sideband. El pie del mapa cuenta el último movimiento. Cuando hay más personas de las que caben, el mapa prioriza a quienes conversan. El selector de personas permite enfocar a participantes específicos.

- En desarrollo, `/flujo?modo=demo` reproduce el escenario ficticio en bucle. En producción, `/flujo` muestra la actividad en vivo.
- `f` activa la pantalla completa. `p` pausa o reanuda la animación.
- La fuente indica **En vivo**, **Conectando**, **Reconectando**, **Sin conexión** o, en desarrollo, **Demo guiada**.

Capturas con participantes ficticios · [Escritorio oscuro](imagenes/flujo/escritorio-oscuro.png) · [Escritorio claro](imagenes/flujo/escritorio-claro.png) · [Móvil](imagenes/flujo/movil.png)

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
