# @team-31/redteam

Harness red team / blue team del broker Sideband. Lanza ataques dirigidos contra cada guardrail
y comprueba, caso por caso, que la defensa los contuvo (o que su falta es un `known_gap`
documentado). Corre contra el núcleo real del broker (`@team-31/broker`, memoria + telemetría
en memoria), sin dependencias del stack: rápido y determinista.

```bash
pnpm --filter @team-31/redteam test                       # suite completa en memoria (determinista)
pnpm --filter @team-31/redteam live                       # subset contra el broker del worktree (HTTP real)
pnpm --filter @team-31/redteam judge                      # juez LLM contra los gaps conocidos (REDTEAM_JUDGE=1 + ANTHROPIC_API_KEY)
pnpm --filter @team-31/redteam agents                     # ataques contra los agentes reales del demo (REDTEAM_AGENTS_LIVE=1)
```

`live` y `agents` exigen el stack correspondiente en marcha (`broker-service` con
`pnpm dev --filter @team-31/broker-service`; para `agents`: web + broker con
`WAKE_ALLOW_INSECURE=1` y `pnpm agents:contacts:seed`). Todos los modos con llave/stack
son `describe.skipIf`: si falta algo, se saltan y jamás rompen `pnpm test`.

## Cómo se organiza

- `src/world.ts` — el escenario: atacante (`mallory`), víctima (`pía`, con su agente
  *comprometido*: responde lo que le pasen) y espectador (`cesar`); llaves Ed25519; canario y
  datos privados ficticios (`CANARY` y compañía, valores sintéticos que jamás deben cruzar).
- `src/cases.ts` — el catálogo de ataques. Cada caso declara `guardrail`, `attack`, veredicto
  `expected` y devuelve una observación. `src/redteam.test.ts` compara y reporta.
- `src/live.test.ts` — el mismo modelo contra el broker HTTP real del worktree.
- `src/judge.ts` — el juez blue team: un Claude (`claude-opus-5-5`, salida estructurada) relee
  lo entregado y marca `private_data | encoded_data | contact | injection_echo | off_topic |`
  `fabrication`. Los casos de `judge.test.ts` miden al juez contra los tres gaps del leak-guard:
  si marca base64, paráfrasis e identificadores, el juez es candidato a redactor por defecto.
- `src/agents-live.test.ts` — ataques contra los agentes reales del demo (sesiones Claude de
  Contactos de Ana): una inyección viaja *dentro del dato* (`interest`) y el test comprueba que
  la respuesta no se enriquece más allá de `{matches}`, que nada prohibido cruza y que el juez
  la aprueba.

Los veredictos `known_gap` son parte del diseño: representan vectores que hoy pasan (codificación
en base64, paráfrasis de instrucciones, identificadores que no son contacto). Si el broker mejora
y un gap deja de fugarse, el test falla y hay que mover el caso a `contained` con su nota.

## Guardrails cubiertos

| Guardrail | Ataques |
| --- | --- |
| `broker.policy` | pregunta sin grant, categoría cruzada, categoría omitida, enumeración de direcciones |
| `broker.stillAuthorized` | revocación del grant con entrega pendiente |
| `broker.wake` | contenido prohibido dentro del aviso al destinatario |
| `sanitize.leak-guard` | canario plano/invisible/homoglifo/espaciado, correo «(arroba)», `hxxp` + teléfono, marcadores de inyección, eco del remitente |
| `broker.nonce` / identidad | reuse de nonce, doble respuesta, agente ajeno, respuesta tardía |
| `broker.firma` | sobre final falsificado |
| `telemetry` | contenido prohibido en `ops.events`; `flags` solo con códigos |

## Añadir un ataque

1. Un caso nuevo en `src/cases.ts` con `guardrail`, `attack` y `expected`.
2. Si el ataque **contiene** un dato sintético (canario, correo ficticio), define el valor en
   `world.ts` y búscalo de vuelta como evidencia; nunca uses datos reales.
3. En el PR, declara el hallazgo: si es `known_gap`, explica en `note` cómo cerrarlo.
