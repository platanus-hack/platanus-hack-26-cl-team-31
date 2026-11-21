# @team-31/broker

Núcleo del broker: autenticación, API pública y frontera de salida. Toda respuesta que viaja hacia el solicitante pasa antes por el saneamiento de `src/sanitize/`.

## Saneamiento de respuestas (`sanitizeReply`)

`sanitizeReply(raw, ctx)` convierte la respuesta cruda de un agente en un resultado seguro, tipado y canónico. Devuelve `{ result, delivered, dropped, flags }`, compatible con `ReplyReceipt` (`deliveredFields`/`droppedFields`).

```ts
import { sanitizeReply } from "@team-31/broker";

// `decision` es el resultado { kind: "allow" } de evaluate() (src/policy).
const report = await sanitizeReply(reply.result, {
  tool: "question",
  allowedFields: decision.allowedFields, // de evaluate()
  guidance: decision.guidance,
  privateHints: ["Terapia", "Dr. Soto"], // textos privados del dueño (p. ej. títulos de su calendario)
  canaries: ["NEXO-CANARY-91c2"],
  senderMessage: inboxItem.senderMessage, // texto no confiable del solicitante
});
```

### Etapas

Cada etapa es una función pura `(state, ctx) => state` y tiene sus propias pruebas.

| Etapa | Archivo | Qué hace |
| --- | --- | --- |
| parse | `parse.ts` | Lee el objeto una sola vez (sin getters, sin `__proto__`/`constructor`/`prototype`, con límites de tamaño) y lo valida contra `ToolResultSchemas[tool]`. Los campos desconocidos se descartan y se reportan (`unknownKeys: "reject"` los rechaza). |
| canonicalize | `canonicalize.ts` | Elimina caracteres de control, de ancho cero, bidi y tags Unicode. Aplica NFC, colapsa espacios y recorta a largos máximos (`fields.ts`). Ordena, deduplica y fusiona los horarios `HH:MM-HH:MM`. Normaliza fechas a ISO. |
| policy | `policy.ts` | Delega en `filterResult` de `src/policy` y no reimplementa la lista blanca. |
| redact | `redact.ts` | Opcional y solo para texto libre (`question.answer`). Usa la interfaz `Redactor`: por defecto `identityRedactor`, y `createFakeRedactor()` para pruebas. |
| parse → canonicalize → policy | | Se repiten después de redact porque su salida no es confiable. |
| leak-guard | `leak-guard.ts` | Barrera determinista final. Bloquea pistas privadas (incluso ofuscadas con homoglifos, leetspeak o separadores), canarios, emails, teléfonos, URLs y ecos del `senderMessage` o marcadores de inyección. Un canario o una fuga en un campo obligatorio lanza `SanitizeBlockedError` (`forbidden`), y una fuga en un campo opcional elimina ese campo. |

Al final, `toReport` vuelve a validar el esquema y comprueba que no haya campos fuera de `allowedFields`. Los errores son siempre `BrokerError`, y los mensajes y flags nunca incluyen el texto que se detectó.

### Redactor con Claude (opcional)

`@team-31/broker/sanitize/claude` exporta `createClaudeRedactor({ model?, effort?, client? })`, que usa structured outputs (`claude-opus-5-5` con esfuerzo `low` por defecto). No forma parte del índice ni del camino por defecto. Requiere `ANTHROPIC_API_KEY` en `.env.local`. Las pruebas usan un cliente falso y nunca llaman a la red. Aunque se use el modelo, leak-guard sigue teniendo la última palabra.

### Cómo agregar una etapa

1. Crea `src/sanitize/<etapa>.ts` y exporta un `SyncStage` o un `Stage` (si es async) que reciba y devuelva un `SanitizeState` nuevo, sin mutarlo. Usa `addFlags`/`addDropped` y lanza `BrokerError` si debe rechazar.
2. Si necesitas un flag nuevo, agrégalo a `FlagCode` en `types.ts`.
3. Agrégala a `defaultStages` en `pipeline.ts`, o pásala en una lista propia: `sanitizeReply(raw, ctx, [parse, canonicalize, miEtapa, policy, leakGuard])`. Las etapas no deterministas van antes de la repetición parse → canonicalize → policy → leak-guard.
4. Escribe `<etapa>.test.ts` y verifica que `properties.test.ts` siga pasando: valida el esquema, no hay campos fuera de `allowedFields`, no hay pistas privadas y el resultado es idempotente.
5. Si la protocol agrega un campo, agrega su regla en `FIELD_SPECS`. Hay una prueba que falla si falta.

```bash
pnpm --filter @team-31/broker test   # o pnpm test desde la raíz
```
