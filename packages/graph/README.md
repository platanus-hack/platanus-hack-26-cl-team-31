# @team-31/graph

Prueba de concepto de **indexación del grafo de relaciones y búsqueda eficiente
de caminos**. Responde preguntas como:

- "¿Cómo estoy conectado con alguien interesado en X?"
- "¿Quién en mi red comparte el tema T conmigo?"
- "¿Qué vaults se relacionan con este?"

…sin cargar ni consultar la topología completa en cada búsqueda: cada consulta
toca solo el vecindario que explora.

> Aún no está conectado a `apps/server`. Los permisos **no** viven aquí: la
> búsqueda recibe un hook de visibilidad (ver [Permisos](#permisos-el-hook-edgefilter)).

```bash
pnpm --filter @team-31/graph test                                # vitest (los de Postgres usan TEST_DATABASE_URL)
pnpm --filter @team-31/graph bench                               # memoria: 1k / 10k / 100k personas
pnpm with-env pnpm --filter @team-31/graph bench:pg              # + Postgres en DATABASE_URL (schema graph_bench)
pnpm with-env pnpm --filter @team-31/graph demo -- --sample      # sobre la base sembrada por `pnpm agents:up`
```

Opciones del bench: `--sizes 1000,10000`, `--pg-sizes 1000,10000`, `--queries 200`, `--landmarks 8`.

## Modelo

| Nodo     | Id             | Origen hoy                       |
| -------- | -------------- | -------------------------------- |
| persona  | `person:<id>`  | `people`                         |
| grupo    | `group:<id>`   | `memberships.group_id`           |
| tema     | `topic:<x>`    | `interests.interest` (`lower(btrim(x))`) |
| vault    | `vault:<id>`   | futuro (colecciones de datos de un usuario) |

| Arista          | Entre               | Notas |
| --------------- | ------------------- | ----- |
| `member_of`     | persona — grupo     | `attrs = {canAsk, canShare}` (solo se transportan, no se interpretan) |
| `interested_in` | persona — tema      | `scope` = audiencia (`''` público, si no id de grupo) |
| `owns`          | persona — vault     | futuro |
| `about`         | vault — tema        | futuro |
| `related_to`    | vault — vault, tema — tema | similitud (futuro: embeddings) |
| `knows`         | persona — persona   | futuro |

Las relaciones son **no dirigidas**: cada una se guarda como dos arcos
(`a→b`, `b→a`) con el mismo costo. Una misma persona puede tener varias aristas
`interested_in` al mismo tema con distintas audiencias (una por `scope`).

Las tablas core se proyectan con `projectCore(rows)` (o, en Postgres,
`PgGraphIndex.rebuildFromCore()`), y cada cambio puntual con
`membershipMutation(row, "upsert" | "delete")` / `interestMutation(...)` /
`personMutation(...)`, que producen `GraphMutation`s aplicables a ambos índices.

## Función de costo

"Peso" = distancia: menor = más cercano.

```
peso(u→v) = base(arista) + (pen(u) + pen(v)) / 2
pen(n)    = HUB[kind(n)] · log2(1 + grado(n))
```

| base                          | valor | razón |
| ----------------------------- | ----- | ----- |
| `member_of`                   | 1.0   | compartir grupo es la señal más fuerte |
| `interested_in` con audiencia | 1.5   | un interés compartido en privado acerca más… |
| `interested_in` público       | 2.0   | …que uno público |
| `owns`                        | 0.5   | el vault es casi la persona |
| `about`                       | 1.5   | |
| `related_to`                  | 1 + 2·(1 − similitud) | 1 (idénticos) … 3 (poco similares) |

| HUB (penalización por grado) | persona 0 · grupo 0.5 · tema 0.75 · vault 0.1 |
| ---------------------------- | --------------------------------------------- |

- **Hubs penalizados**: pasar por "música" (10 000 interesados) cuesta
  ≈ 0.75·13.3 ≈ 10, pasar por un tema de nicho con 5 interesados ≈ 1.9. Así los
  caminos no se van todos por los temas o grupos masivos y "compartir algo raro"
  pesa más que "compartir algo popular".
- **Simétrico**: la penalización se reparte mitad y mitad entre los extremos;
  por eso sirven Dijkstra bidireccional y landmarks sin distinguir dirección.
  Sobre un camino, cada nodo intermedio suma su `pen` completo y los extremos la
  mitad (constante para punto a punto).
- **Grado leído al recorrer**, no guardado en la arista: agregar un miembro a un
  grupo es O(1) y no obliga a reescribir las aristas de los demás miembros.

Constantes en `src/cost.ts` (`BASE_COST`, `HUB_PENALTY`); son una primera
calibración, no un resultado.

## Índices

Los algoritmos solo ven una `AdjacencyView` (`arcs(id)`, `penalty(id)`), así
que el mismo código corre sobre los dos índices.

### En memoria — `MemoryGraphIndex`

Mapa `id → {arcos, penalización}`. `apply(mutations)` es incremental: upsert
de arista O(grado) (busca el arco existente), borrado O(grado) con
swap-remove, y la penalización de los extremos se recalcula en O(1). Nunca
reconstruye. Útil para búsquedas de milisegundos, tests y ALT (que necesita el
grafo completo).

### Postgres — `PgGraphIndex` (`@team-31/graph/pg`)

SQL en [`sql/graph.sql`](sql/graph.sql): `graph_nodes(id, kind, degree, label)` y
`graph_edges(src, dst, kind, scope, base, attrs)` con
`PRIMARY KEY (src, dst, kind, scope)`. Es una **proyección derivada**: se puede
reconstruir desde las tablas core en cualquier momento.

- **Búsqueda**: cada búsqueda crea una vista perezosa (caché de adyacencias).
  Cuando al algoritmo le falta la adyacencia de un nodo, pide ese nodo **más
  hasta `batchSize − 1` nodos de la frontera** (los primeros del heap ≈ los más
  baratos) y el adaptador los resuelve con **una sola consulta indexada**:

  ```sql
  SELECT e.src, e.dst, e.kind, e.scope, e.base, e.attrs,
         CASE WHEN split_part(e.dst, ':', 1) = ANY($2) THEN 0      -- tipos sin penalización (personas)
              ELSE (SELECT degree FROM graph_nodes WHERE id = e.dst) END AS dst_degree
  FROM graph_edges e
  WHERE e.src = ANY($1::text[])
  ```

  El grado del vecino (para su penalización) se lee con un lookup por PK solo
  para grupos/temas/vaults; un `JOIN` normal hacía que el planner eligiera hash
  join + seq scan de `graph_nodes` en lotes grandes. Tras cargas completas se
  hace `CLUSTER graph_edges USING graph_edges_pkey` (`compact()`) para que la
  adyacencia de un nodo quede en pocas páginas. Las
  estadísticas reportan `queries` y `rowsFetched` por búsqueda.
- **Mutaciones**: `apply(mutations)` hace upsert/borrado de ambos arcos y ajusta
  `degree` en la misma sentencia (CTE con `RETURNING`). No abre transacción: se
  pensó para correr en la transacción del cambio de origen (p. ej. el `INSERT`
  en `memberships`).
- `bulkLoad(mutations)` (carga con `unnest` por lotes + recálculo de grados) y
  `rebuildFromCore()` (`INSERT … SELECT` desde `people`/`memberships`/`interests`,
  con los mismos costos base que TS) para sincronizaciones completas.

Implementación con generadores: los algoritmos hacen `yield {ids}` cuando les
falta una adyacencia; `runSync` (memoria, nunca recibe un yield) y `runAsync`
(Postgres, una consulta por yield) son los drivers. Un solo código de
algoritmos, sin `await` en el loop interno en memoria.

## Algoritmos

Todos devuelven `paths` (nodos + arcos orientados + costo; `explain(path)` lo
pasa a texto) y `stats` (`expanded`, `edgesScanned`, `pushes`, `fetches`,
`fetchedNodes`, `stopReason`). Presupuestos comunes: `maxCost`, `maxExpanded`.

| Función | Uso | Idea |
| --- | --- | --- |
| `dijkstra` | base de todo | heap binario con lazy deletion, salida temprana en `target`, o en el k-ésimo nodo que cumple `match`; poda por `maxCost`; potencial A* opcional |
| `bidirectional` | punto a punto (**default**) | dos frentes, expande el de menor tope, para cuando `topF + topB ≥ mejor` |
| `nearestSearch` / `index.nearest` | k más cercanos que cumplen un predicado | Dijkstra multi-objetivo; el predicado ve solo aristas visibles (`matchers.ofKind`, `interestedIn`, `linkedTo`, `inSet`, `and`) |
| `targetedNearest` | k más cercanos dentro de un conjunto **conocido** de candidatos | (1) Dijkstra multi-origen hacia atrás desde los candidatos, acotado (`backwardBudget`), da `db(v)` exacto dentro de un radio `R`; (2) A* desde el origen con `h(v) = min(db(v), R)`. `h` es consistente (mínimo de dos potenciales consistentes), así que es exacto |
| `interestedInSearch` / `index.interestedIn` | **consulta principal**: k personas más cercanas interesadas en T | `auto`: lee los interesados del tema (1 fetch) y usa `targetedNearest` si son ≤ 256; si no, Dijkstra hacia adelante (para temas masivos los encuentra de inmediato). Cada camino trae `evidence` (la arista `le interesa` visible) |
| ALT (`algorithm: "alt"`) | punto a punto, experimental | A* con landmarks ("farthest"), cota `max_L |d(L,t) − d(L,v)|`. Modos `effective` (con penalización) y `base` (sin ella) |

### ¿Vale la pena ALT? No por ahora

Ver benchmarks: en esta red de mundo pequeño **bidireccional expande 4–17×
menos nodos que ALT effective (8 landmarks) y 5–80× menos que ALT base**, sin
preprocesamiento (a 100k personas: 451 vs 7 715 vs 38 007 expandidos).
Además ALT:

- no sirve para la consulta principal (multi-objetivo, destino desconocido);
- cuesta L Dijkstras completos de preproceso y O(L·V) memoria;
- se invalida con las mutaciones: en modo `effective` cualquier cambio de grado
  cambia pesos (se detecta con `index.version` y se cae a bidireccional,
  `stats.fallback`); en modo `base` solo las aristas nuevas lo invalidan, pero
  las cotas son flojas porque la penalización de hubs es buena parte del costo;
- no está disponible en Postgres (necesitaría una tabla de landmarks y el
  potencial requiere distancias de nodos aún no cargados).

Queda implementado y testeado como referencia. La idea útil que sí se adoptó es
la de **potencial A* calculado desde el lado del objetivo** (`targetedNearest`),
que no necesita preproceso ni se invalida.

## Permisos: el hook `EdgeFilter`

Este paquete **no implementa permisos**. Toda búsqueda acepta:

```ts
type EdgeFilter = (arc: Arc, ctx: { viewer: NodeId | undefined }) => boolean;
index.nearest(me, { match, filter, viewer: me });  // default: allowAll
```

Contrato:

- Se llama por cada arista antes de recorrerla, **orientada en el sentido del
  recorrido** (alejándose del origen). En las búsquedas hacia atrás
  (bidireccional, `targetedNearest`) se pasa ya invertida, así que el filtro
  siempre ve `origen → … → destino`.
- `false` = la arista no existe para esta búsqueda: no se recorre, no aparece
  en caminos y los predicados `match` tampoco la ven (p. ej. un interés privado
  bloqueado no hace "interesada" a esa persona).
- Debe ser síncrono y barato (loop interno). Recibe `arc.kind`, `arc.scope`
  (audiencia: `''` o id de grupo) y `arc.attrs` (`canAsk`/`canShare` de la
  membresía) para que el equipo de permisos exprese sus reglas, típicamente
  precargando el contexto del viewer (sus grupos, bloqueos) antes de buscar.
- Es correcto con todos los algoritmos, incluso ALT: el grafo filtrado es un
  subgrafo y las cotas de landmarks siguen siendo válidas.

Hoy el filtro se aplica en la app después del fetch. Si el volumen lo pide, el
siguiente paso es empujar la parte "estática" de la regla al SQL de vecinos
(p. ej. `AND (e.scope = '' OR e.scope = ANY($viewerGroups))`) manteniendo el
hook para el resto.

## Benchmarks

Grafo sintético determinista (`syntheticGraph({people, seed})`): comunidades de
~200 personas con grupos propios (85% de membresías locales, 15% globales con
Zipf → algunos grupos enormes), temas con popularidad Zipf (s≈1.07) más ~30
temas favoritos por comunidad, 25% de intereses con audiencia privada, y 30% de
las personas con un vault relacionado con 1–2 vaults de su comunidad.

Resultados de `pnpm with-env pnpm --filter @team-31/graph bench:pg --queries 200`
(Node 24, Postgres 17 en Docker local, una conexión, base `app` del slot en el
schema `graph_bench`; 200 consultas en memoria, 100 en Postgres para 1k/10k y
30 para 100k). Todos los algoritmos se verifican entre sí en cada consulta (mismo
costo). Latencias de un laptop de desarrollo: sirven para comparar, no como SLA.

#### Construcción e incrementalidad (memoria)

| personas | nodos | relaciones | generar ms | indexar ms | landmarks ms (base / eff) | landmarks MB | update µs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 1,444 | 8,590 | 13 | 10 | 18 / 33 | 0.1 | 1.7 |
| 10,000 | 14,230 | 79,757 | 80 | 71 | 283 / 452 | 0.9 | 5.5 |
| 100,000 | 141,576 | 790,649 | 727 | 1860 | 8121 / 12524 | 9.1 | 1.8 |

#### Punto a punto persona→persona (200 pares, memoria)

| personas | algoritmo | expandidos | aristas | media ms | p50 ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | dijkstra | 732 | 8,995 | 1.257 | 1.295 | 2.171 |
| 1,000 | bidirectional | 66 | 1,166 | 0.390 | 0.316 | 0.876 |
| 1,000 | ALT base (8) | 317 | 4,090 | 0.884 | 0.718 | 1.971 |
| 1,000 | ALT effective (8) | 74 | 971 | 0.299 | 0.241 | 0.779 |
| 10,000 | dijkstra | 7,216 | 93,839 | 39.895 | 28.401 | 129.323 |
| 10,000 | bidirectional | 187 | 5,010 | 4.207 | 2.706 | 18.130 |
| 10,000 | ALT base (8) | 3,160 | 46,589 | 28.817 | 20.579 | 99.967 |
| 10,000 | ALT effective (8) | 709 | 10,392 | 8.788 | 5.295 | 30.285 |
| 100,000 | dijkstra | 72,164 | 945,760 | 759.574 | 634.575 | 2417.824 |
| 100,000 | bidirectional | 451 | 29,622 | 45.953 | 30.661 | 184.904 |
| 100,000 | ALT base (8) | 38,007 | 556,633 | 585.262 | 478.049 | 1711.546 |
| 100,000 | ALT effective (8) | 7,715 | 103,109 | 135.834 | 87.887 | 427.381 |

#### Más cercanos (200 consultas, memoria)

| personas | consulta | encontrados | expandidos | aristas | media ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | k=10 personas · tema popular (top 1%) · forward | 10.0 | 31 | 674 | 0.192 | 0.396 |
| 1,000 | k=10 personas · tema popular (top 1%) · targeted | 10.0 | 1,458 | 15,490 | 2.514 | 3.708 |
| 1,000 | k=10 personas · tema popular (top 1%) · auto | 10.0 | 31 | 674 | 0.189 | 0.396 |
| 1,000 | k=10 personas · tema nicho (cola) · forward | 9.9 | 602 | 7,725 | 1.195 | 2.196 |
| 1,000 | k=10 personas · tema nicho (cola) · targeted | 9.9 | 476 | 7,439 | 1.750 | 2.807 |
| 1,000 | k=10 personas · tema nicho (cola) · auto | 9.9 | 476 | 7,439 | 1.414 | 1.955 |
| 1,000 | k=5 vaults relacionados | 5.0 | 17 | 284 | 0.076 | 0.281 |
| 10,000 | k=10 personas · tema popular (top 1%) · forward | 10.0 | 135 | 3,774 | 1.220 | 3.259 |
| 10,000 | k=10 personas · tema popular (top 1%) · targeted | 10.0 | 6,832 | 82,388 | 42.241 | 135.629 |
| 10,000 | k=10 personas · tema popular (top 1%) · auto | 10.0 | 135 | 3,774 | 1.225 | 3.180 |
| 10,000 | k=10 personas · tema nicho (cola) · forward | 9.6 | 5,930 | 81,152 | 38.009 | 133.479 |
| 10,000 | k=10 personas · tema nicho (cola) · targeted | 9.6 | 2,173 | 30,374 | 9.450 | 42.857 |
| 10,000 | k=10 personas · tema nicho (cola) · auto | 9.6 | 2,173 | 30,374 | 11.280 | 41.746 |
| 10,000 | k=5 vaults relacionados | 5.0 | 15 | 250 | 0.337 | 0.936 |
| 100,000 | k=10 personas · tema popular (top 1%) · forward | 10.0 | 1,830 | 82,813 | 93.211 | 334.360 |
| 100,000 | k=10 personas · tema popular (top 1%) · targeted | 10.0 | 9,748 | 144,516 | 159.034 | 620.441 |
| 100,000 | k=10 personas · tema popular (top 1%) · auto | 10.0 | 1,830 | 82,813 | 94.303 | 336.112 |
| 100,000 | k=10 personas · tema nicho (cola) · forward | 6.9 | 43,398 | 671,918 | 608.684 | 1599.998 |
| 100,000 | k=10 personas · tema nicho (cola) · targeted | 9.0 | 10,717 | 207,833 | 175.032 | 503.607 |
| 100,000 | k=10 personas · tema nicho (cola) · auto | 9.0 | 10,717 | 207,833 | 191.920 | 513.006 |
| 100,000 | k=5 vaults relacionados | 5.0 | 15 | 310 | 0.190 | 0.681 |

#### Postgres (graph_bench, DATABASE_URL)

| personas | búsqueda | expandidos | consultas | filas | media ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | interesados k=10 tema nicho · forward · batch 1 | 530 | 529.9 | 6,927 | 337.38 | 1124.33 |
| 1,000 | interesados k=10 tema nicho · forward · batch 32 | 530 | 25.6 | 9,460 | 80.53 | 319.28 |
| 1,000 | interesados k=10 tema nicho · forward · batch 128 | 530 | 10.7 | 12,212 | 53.82 | 78.75 |
| 1,000 | interesados k=10 tema nicho · targeted · batch 32 | 471 | 25.4 | 10,193 | 89.13 | 232.38 |
| 1,000 | interesados k=10 tema nicho · targeted · batch 128 | 471 | 10.0 | 10,763 | 39.76 | 52.68 |
| 1,000 | vaults relacionados k=5 · batch 32 | 10 | 3.2 | 1,507 | 5.73 | 8.57 |
| 1,000 | path dijkstra · batch 32 | 722 | 31.3 | 11,098 | 65.94 | 104.35 |
| 1,000 | path bidirectional · batch 32 | 64 | 6.0 | 3,033 | 13.81 | 31.91 |
| 1,000 | bulkLoad 0.5 s · apply() 1.08 ms/mutación |  |  |  |  |  |
| 10,000 | interesados k=10 tema nicho · forward · batch 1 | 3,224 | 3224.2 | 52,892 | 2574.47 | 5569.53 |
| 10,000 | interesados k=10 tema nicho · forward · batch 32 | 3,224 | 142.2 | 69,797 | 466.75 | 1202.92 |
| 10,000 | interesados k=10 tema nicho · forward · batch 128 | 3,224 | 56.0 | 95,860 | 511.09 | 857.76 |
| 10,000 | interesados k=10 tema nicho · targeted · batch 32 | 607 | 35.4 | 25,363 | 115.06 | 142.85 |
| 10,000 | interesados k=10 tema nicho · targeted · batch 128 | 607 | 14.5 | 37,858 | 140.02 | 165.04 |
| 10,000 | vaults relacionados k=5 · batch 32 | 9 | 2.8 | 4,464 | 12.87 | 28.47 |
| 10,000 | path dijkstra · batch 32 | 6,563 | 254.1 | 103,948 | 933.87 | 2523.72 |
| 10,000 | path bidirectional · batch 32 | 177 | 12.2 | 10,694 | 44.08 | 80.22 |
| 10,000 | bulkLoad 7.7 s · apply() 1.29 ms/mutación |  |  |  |  |  |
| 100,000 | interesados k=10 tema nicho · forward · batch 32 | 5,000 | 246.7 | 243,570 | 1409.55 | 1839.27 |
| 100,000 | interesados k=10 tema nicho · forward · batch 128 | 5,000 | 133.7 | 373,578 | 2032.27 | 3216.88 |
| 100,000 | interesados k=10 tema nicho · targeted · batch 32 | 1,483 | 79.4 | 135,697 | 535.97 | 795.80 |
| 100,000 | interesados k=10 tema nicho · targeted · batch 128 | 1,483 | 33.4 | 199,058 | 763.03 | 1068.83 |
| 100,000 | vaults relacionados k=5 · batch 32 | 8 | 2.6 | 20,835 | 65.86 | 169.39 |
| 100,000 | path dijkstra · batch 32 | 67,425 | 2459.1 | 1,022,024 | 26012.55 | 51771.62 |
| 100,000 | path bidirectional · batch 32 | 458 | 26.0 | 60,137 | 211.09 | 570.68 |
| 100,000 | bulkLoad 72.4 s · apply() 1.14 ms/mutación |  |  |  |  |  |

**Lectura:**

- **Punto a punto**: bidireccional expande 11×/39×/160× menos nodos que Dijkstra
  (1k/10k/100k) y es la mejor opción sin preproceso. ALT effective queda
  4–17× por detrás de bidireccional y ALT base casi no mejora a Dijkstra (ver
  [arriba](#vale-la-pena-alt-no-por-ahora)).
- **Consulta principal (interesados en T)**: para temas populares, hacia adelante
  encuentra 10 interesados en pocas expansiones; para temas de nicho
  `targetedNearest` expande 2.7–4× menos y, con presupuesto fijo, encuentra más
  (100k: 9.0 vs 6.9 de 10 con `maxExpanded` 50 000). `auto` elige bien en todos
  los casos (umbral 256 interesados).
- **Postgres**: el batching de frontera baja las consultas de una por nodo a
  ~1 por cada 20–40 nodos (530 → 26 a 1k; bidireccional a 100k: 26 consultas,
  ~210 ms). Lotes más grandes reducen consultas pero traen más filas: el costo
  dominante pasa a ser el fan-out de los hubs (expandir un tema popular trae
  miles de filas), de ahí que 128 no siempre gane a 32. Dijkstra simple en
  Postgres no escala (100k: 2 459 consultas, 26 s): usar bidireccional / targeted.
- **Incremental**: una mutación cuesta ~2 µs en memoria y ~1 ms en Postgres
  (upsert de ambos arcos + grados), contra 1.9 s / 72 s de reconstrucción
  completa a 100k.


## Próximos pasos

1. **Vaults**: tabla real de vaults y su proyección (`owns`, `about`,
   `related_to`); el modelo y el bench ya los incluyen.
2. **Similitud semántica**: embeddings de temas/vaults → aristas
   `related_to` (tema—tema, vault—vault) top-k por vecino con
   `base = 1 + 2·(1 − sim)`; resuelve "ajedrez" ≈ "chess" sin cambiar los
   algoritmos. Candidatos con pgvector.
3. **Herramienta MCP**: exponer `nearest`/`interestedIn`/`path` con `explain()`
   como tool del agente, con el `EdgeFilter` del equipo de permisos y budgets
   fijos (`maxExpanded`, `maxCost`) para acotar latencia.
4. **Mantener la proyección**: triggers o el outbox del server llamando
   `PgGraphIndex.apply()` en la misma transacción que el cambio de origen;
   `rebuildFromCore()` como reparación periódica.
5. **Rendimiento**: caché compartido de adyacencias entre búsquedas
   (invalidado por versión), ids enteros internos en memoria, filtro empujado a
   SQL, y cap de fan-out al expandir hubs (leer solo los N vecinos más baratos).
6. **Calibrar costos** con datos reales y feedback (¿qué conexiones fueron útiles?).
