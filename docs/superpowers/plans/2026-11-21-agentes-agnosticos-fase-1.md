# Agentes agnósticos de plataforma — fase 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada titular es un contenedor con solo su CLI y el MCP de Sideband; dos de ellos, con herramientas distintas, se preguntan y se responden en vivo contra un Sideband expuesto por un dominio https real, y el canal de sondeo queda visible en el admin.

**Architecture:** El servidor no cambia de forma: sigue siendo un broker en loopback con web y MCP delante. Lo único que se agrega al producto es un `WakeKind` de sondeo, para que una conexión de CLI deje de ser indistinguible de "nadie conectado". Lo demás es una imagen de contenedor derivada de `~/my-github/os/ai-containers`, el empaquetado del bloque de confianza en tres envases, y un guion reproducible. Como el titular es un contenedor, correrlo en otra máquina es una variable de despliegue, no una precondición.

**Tech Stack:** TypeScript, zod, Node 24, pnpm, Vitest. Broker y protocolo en `packages/*`, MCP en `apps/mcp`, panel en `apps/admin`.

**Spec:** `docs/superpowers/specs/2026-11-21-agentes-agnosticos-design.md`

## Global Constraints

- La herramienta del titular no puede exigir cambios en broker, MCP ni web. Un CLI nuevo es configuración, nunca código de servidor.
- Las seis invariantes de `AGENTS.md` se conservan. Si una tarea toca `packages/broker`, `packages/protocol` o `apps/mcp`, sus pruebas viven en `packages/broker/src/core/broker.test.ts` y cambian en el mismo commit.
- Todo evento nuevo se declara en `packages/telemetry/src/catalog.ts` con su esquema, y `packages/telemetry/src/catalog.test.ts` lo cubre.
- Nunca entran en eventos, logs ni vistas: tokens, encabezados `Authorization`, nonces, secretos de aviso, `args`, `result` ni texto libre de terceros.
- Con `NODE_ENV=production`, `MCP_RESOURCE_URL`, `AUTH_ISSUER` y `AUTH_JWKS_URL` exigen https, sin credenciales, query ni fragmento (`apps/mcp/src/oauth-config.ts`).
- Las URLs públicas se configuran en `.env.local`, que se carga después de `.env` (`scripts/with-env.sh:12-17`). `scripts/env-init.sh` no se edita.
- `general` solo viene en la etiqueta `family` (`packages/protocol/src/constants.ts:24`).
- En el t490 los CLIs viven en `~/.nvm/versions/node/*/bin/` y no están en el PATH de un `bash -lc` no interactivo.
- La regla de ~500 líneas por PR no aplica a este trabajo.
- Antes de dar algo por listo: `pnpm lint && pnpm typecheck && pnpm test`.

## Review Focus

- **Un titular con un canal push y un CLI sondeando a la vez.** El aviso debe seguir yendo al canal push; la conexión de sondeo no puede ganarle y dejar la solicitud sin despertar a nadie. Pinned en Task 2.
- **Dos CLIs vivos del mismo titular tras rotar sin revocar.** Ambos leen la misma bandeja y responden; el segundo debe recibir `conflict` y la solicitud conservar un solo estado final. Pinned en Task 3.
- **Una conexión de sondeo revocada.** Deja de aparecer como destinatario y deja de marcarse viva. Pinned en Task 2.
- **Un titular sin ninguna conexión.** Debe seguir distinguiéndose en el admin de uno con CLI sondeando: `none` contra `polling`. Pinned en Task 4.
- **`MCP_RESOURCE_URL` con query o fragmento en producción.** El MCP no abre el puerto y dice cuál variable está mal. Ya cubierto por `apps/mcp/src/oauth-config.test.ts`; Task 6 solo lo verifica en el arranque real.

---

### Task 1: El `WakeKind` de sondeo en el protocolo

**Files:**
- Modify: `packages/protocol/src/wake.ts:3-10` (enum), `:14-30` (unión)
- Test: `packages/protocol/src/protocol.test.ts`

**Interfaces:**
- Produces: `WakeKind` incluye `"polling"`. La variante es `{ kind: "polling" }`, sin campos: una conexión de sondeo no tiene URL ni secreto, porque nadie le escribe.

- [ ] **Step 1: Write the failing test**

```ts
it("acepta un objetivo de sondeo sin campos", () => {
  expect(WakeTarget.parse({ kind: "polling" })).toEqual({ kind: "polling" });
});

it("rechaza un objetivo de sondeo con URL", () => {
  expect(WakeTarget.safeParse({ kind: "polling", url: "https://x.test" }).success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @team-31/protocol test`
Expected: FAIL, `"polling"` no está en el enum.

- [ ] **Step 3: Add `"polling"` to `WakeKind` and the `{ kind: "polling" }` member to the `WakeTarget` union**

El miembro es `z.strictObject({ kind: z.literal("polling") })`. `strictObject` es lo que hace fallar el segundo test.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @team-31/protocol test`
Expected: PASS

- [ ] **Step 5: Run the full typecheck, because the union is exhaustively matched elsewhere**

Run: `pnpm typecheck`
Expected: errores en `packages/wake/src/index.ts` y `packages/broker/src/core/worker.ts` por casos no cubiertos. Anótalos; Task 2 los resuelve. Si no aparece ninguno, revisa que el enum realmente cambió.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/wake.ts packages/protocol/src/protocol.test.ts
git commit -m "protocol: canal de sondeo como WakeKind"
```

---

### Task 2: El worker reconoce y registra el sondeo

**Files:**
- Modify: `packages/broker/src/core/worker.ts:19` (selección de destinatario), `:81` (entrega)
- Modify: `packages/wake/src/index.ts:9` (`adapterPost` ya excluye `none`; excluir también `polling`)
- Test: `packages/broker/src/core/broker.test.ts`

**Interfaces:**
- Consumes: `WakeTarget` con la variante `{ kind: "polling" }` de Task 1.
- Produces: una conexión con `wakeTarget.kind === "polling"` es elegible como destinatario, se registra como intento con `detail: "polling"`, y **nunca** recibe un POST. `recipient()` la ordena después de cualquier conexión con canal push.

- [ ] **Step 1: Write the failing tests**

```ts
it("registra el despacho a una conexión de sondeo sin llamar al waker", async () => {
  // Titular con una sola conexión, wakeTarget { kind: "polling" }.
  // Tras correr el worker: waker.wake no fue llamado, y el intento quedó con detail "polling".
});

it("prefiere el canal push cuando el titular también tiene un CLI sondeando", async () => {
  // Titular con standard_webhook y polling. El POST va al webhook.
});

it("ignora una conexión de sondeo revocada", async () => {
  // revokedAt presente: no es destinatario y no deja intento.
});
```

Usa el arnés en memoria que ya emplean las pruebas vecinas de este archivo; no montes stack.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @team-31/broker test -- broker.test.ts`
Expected: FAIL. El primero porque `recipient()` descarta todo lo que no sea push; el segundo puede pasar por accidente — confirma que falla por la razón correcta antes de seguir.

- [ ] **Step 3: Implement**

El filtro de `recipient()` **no cambia**: excluye `"none"`, así que `polling` ya entra solo al existir en la unión. Lo que cambia es el orden — agrega al comparador, **antes** de los criterios actuales, uno que mande `polling` al final, para que un canal push siempre gane. En `runWake`, donde hoy se decide `tried`, trata `polling` como una rama propia: no llama a `deliver`, produce `{ ok: true, retryable: false, ms: 0, detail: "polling" }` y se registra con `recordWakeAttempt` igual que las demás. Sigue la forma de `runOriginNotice` en `worker.ts:56`, que ya hace exactamente esto para `detail: "skipped"`.

Ojo con el efecto secundario: al entrar `polling` en la unión, una conexión de sondeo pasa a ser destinatario elegible **antes** de que toques nada. Si el comparador no la manda al final, le robará el aviso a un canal push. Por eso el segundo test de Step 1 es el que importa.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @team-31/broker test`
Expected: PASS, incluidas las seis invariantes.

- [ ] **Step 5: Commit**

```bash
git add packages/broker packages/wake
git commit -m "broker: el canal de sondeo se despacha y se registra sin aviso"
```

---

### Task 3: El MCP marca la conexión al leer la bandeja

**Files:**
- Modify: `apps/mcp/src/tools/inbox.ts`
- Modify: `packages/broker/src/core/broker.ts` (el puerto que atiende `/v1/agent/wake`, hoy en `:834`)
- Test: `packages/broker/src/core/broker.test.ts`, `apps/mcp/src/http.test.ts`

**Interfaces:**
- Consumes: `{ kind: "polling" }` de Task 1; el despacho de Task 2.
- Produces: la primera lectura de `sideband_inbox` de una conexión con `wakeTarget.kind === "none"` la promueve a `"polling"`. Idempotente. Una conexión con un canal push configurado **no** se degrada.

Esta es la pieza que hace la feature agnóstica: ningún CLI declara nada, y leer la bandeja *es* sondear. claude-code, codex y pi quedan cubiertos por el mismo código.

- [ ] **Step 1: Write the failing tests**

```ts
it("promueve a sondeo la conexión que lee su bandeja", async () => {
  // Conexión nueva (kind "none") llama inbox. Después, kind === "polling".
});

it("no degrada una conexión con canal push", async () => {
  // kind standard_webhook llama inbox. Sigue siendo standard_webhook.
});

it("es idempotente", async () => {
  // Dos lecturas seguidas dejan una sola escritura observable.
});

it("una segunda respuesta a la misma solicitud recibe conflict", async () => {
  // Dos conexiones de sondeo del mismo titular responden. La segunda: conflict.
  // Un solo estado final (invariante 5).
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @team-31/broker test -- broker.test.ts`
Expected: FAIL en los tres primeros. El cuarto debería pasar ya — si falla, para: es una regresión de la invariante 5, no trabajo de esta tarea.

- [ ] **Step 3: Implement the promotion in the inbox port**

La promoción va en el núcleo del broker, dentro de la transacción que ya atiende la lectura de bandeja, no en `apps/mcp`. Así cualquier cliente del `AgentPort` la obtiene. `apps/mcp/src/tools/inbox.ts` no cambia salvo que hoy no propague algo que la promoción necesite.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @team-31/broker test && pnpm --filter @team-31/mcp test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/broker apps/mcp
git commit -m "broker: leer la bandeja marca la conexión como canal de sondeo"
```

---

### Task 4: El sondeo visible en el admin

**Files:**
- Modify: `packages/telemetry/src/catalog.ts:189-196` (atributos de `wake.attempt`)
- Modify: `packages/ops/sql/` (nueva migración numerada, solo si una vista `ops.v_*` necesita exponer el canal)
- Test: `packages/telemetry/src/catalog.test.ts`, `packages/broker/src/core/telemetry.test.ts`

**Interfaces:**
- Consumes: el intento con `detail: "polling"` de Task 2.
- Produces: `wake.attempt` admite `kind: "polling"`. `views.ts:103` ya expone `wakeKind`, así que el panel distingue `none` de `polling` sin cambios de esquema.

- [ ] **Step 1: Write the failing test**

```ts
it("emite wake.attempt con kind polling y ok true", async () => {
  // Despacho a una conexión de sondeo. El evento sale con attrs.kind === "polling",
  // ok true, sin httpStatus.
});

it("distingue un titular sin conexiones de uno sondeando", async () => {
  // Sin conexión: ningún wake.attempt. Con sondeo: uno, kind polling.
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @team-31/broker test -- telemetry.test.ts`
Expected: FAIL

- [ ] **Step 3: Emit the event from the polling branch of `runWake`**

El evento es el `wake.attempt` que ya existe; no se declara uno nuevo. `attrs.kind` toma el valor del `WakeKind`, así que `"polling"` entra solo. Verifica que `code()` en el catálogo no restrinja el conjunto de valores; si lo hace, amplíalo ahí.

- [ ] **Step 4: Run tests and the catalog check**

Run: `pnpm --filter @team-31/telemetry test && pnpm --filter @team-31/broker test`
Expected: PASS

- [ ] **Step 5: Confirm the admin surfaces it**

Run: `pnpm --filter @team-31/admin test`
Expected: PASS. Si una vista o consulta filtra por `kind` con una lista fija, amplíala y agrega su prueba en `apps/admin/server/queries/queries.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/telemetry packages/broker packages/ops apps/admin
git commit -m "admin: el canal de sondeo se ve como cualquier otro"
```

### Task 5: El login de desarrollo

**Files:**
- Modify: `packages/auth/src/server.ts` (opciones de Better Auth)
- Modify: `apps/web/src/` (ruta de dev-login y su guarda de entorno)
- Modify: `.env.local.example`
- Test: junto a las pruebas de auth que ya usan `TEST_DATABASE_URL`

**Interfaces:**
- Produces: `SIDEBAND_DEV_AUTH=1` habilita crear e iniciar sesión como un titular de prueba sin Google. Task 9 levanta tres titulares con esto.

**Por qué:** el proveedor de identidad es ortogonal a lo que la fase prueba. El CLI sigue obteniendo un access token OAuth real con registro dinámico y verificación por JWKS; lo único que cambia es cómo el humano se autentica en la pantalla de login. Quita el techo de dos cuentas de Google y elimina la dependencia de que Google acepte un redirect en un dominio ajeno.

**Precedente a copiar, no a inventar:** `ADMIN_DEV_AUTH` en `apps/admin/server/env.ts:48` (rechazo al parsear si `NODE_ENV=production`) y `apps/admin/server/api.ts:348` (la ruta sólo se registra con la bandera activa). Las otras dos guardas del repo son `MCP_DEV_AUTH` (`packages/auth/src/resource.ts:19`) y `WAKE_ALLOW_INSECURE` (`apps/broker/src/env.ts:49`).

- [ ] **Step 1: Write the failing tests**

```ts
it("rechaza SIDEBAND_DEV_AUTH en producción", () => {
  // NODE_ENV=production + SIDEBAND_DEV_AUTH=1 => el parseo del entorno falla
  // nombrando la variable. Misma forma que apps/admin/server/env.ts:48.
});

it("no registra la ruta de dev-login sin la bandera", async () => {
  // Sin SIDEBAND_DEV_AUTH la ruta responde 404.
});

it("crea y autentica un titular de prueba con la bandera activa", async () => {
  // Con la bandera: se crea el usuario si no existe, queda sesión iniciada,
  // y el titular tiene dirección Sideband utilizable.
});

it("dos titulares de prueba distintos no comparten sesión", async () => {
  // Es el punto de la tarea: N identidades simultáneas sin N cuentas de Google.
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm with-env pnpm --filter @team-31/auth test && pnpm with-env pnpm --filter @team-31/web test`
Expected: FAIL. Confirma que fallan por la ausencia de la bandera y de la ruta, no por configuración.

- [ ] **Step 3: Implement**

La guarda de entorno va primero y sigue la forma de `apps/admin/server/env.ts:48`: rechazo al parsear, no en el momento de usarla. La ruta sólo se registra cuando la bandera está activa, como `api.ts:348`.

Cómo se crea la sesión queda al constructor: puede ser `emailAndPassword` de Better Auth o una ruta que fabrique la sesión directamente. Si eliges `emailAndPassword`, comprueba si el esquema de Better Auth necesita columnas nuevas y corre `pnpm sideband:auth:migrate` en el mismo PR.

**El consentimiento no se salta.** Es parte del flujo que la fase prueba. Sólo cambia cómo el humano demuestra quién es.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm with-env pnpm test`
Expected: PASS salvo el flake conocido de `@team-31/admin > server/tokens.test.ts`.

- [ ] **Step 5: Declarar la variable**

`SIDEBAND_DEV_AUTH` en `.env.local.example`, con una línea que diga que no se permite en producción.

- [ ] **Step 6: Commit**

```bash
git add packages/auth apps/web .env.local.example
git commit -m "auth: login de desarrollo para probar varios titulares sin Google"
```

---

---
### Task 6: El stack tras el dominio

**Files:**
- Create: `docs/agents/titulares-en-contenedor.md`
- Modify: `.env.local.example`

**Interfaces:**
- Produces: un origen https estable servido por el túnel, con el MCP arrancado en modo producción. Las tareas 6 a 8 lo dan por hecho.

Configuración, no código. Su prueba es el arranque real.

- [ ] **Step 1: Exponer web y MCP con Tailscale Serve**

HTTPS ya está habilitado en el tailnet (2026-11-21). `tailscale serve` da un nombre MagicDNS estable con certificado real de Let's Encrypt, alcanzable **sólo dentro del tailnet**, no desde internet. Se exponen **solo** web y MCP; broker y postgres no se publican.

El nombre del Mac es `alfredo-martnezs-macbook-pro.tail88af94.ts.net` y el del t490 `aenrione-t490.tail88af94.ts.net`. Verifica el certificado antes de seguir: `curl -I https://<nombre>/` desde el t490 debe dar 200 sin advertencias de TLS.

- [ ] **Step 2: Escribir las URLs públicas en `.env.local`**

Las cuatro en https, sin credenciales, sin query y sin fragmento. `BROKER_URL` se queda en loopback. Declara en `.env.local.example` toda variable nueva.

- [ ] **Step 3: No hace falta tocar Google**

El escenario usa el login de desarrollo de Task 5, así que no hay redirect que registrar. Google queda configurado como está, para el uso normal.

- [ ] **Step 4: Arrancar en modo producción y comprobar que el MCP valida**

Run: `pnpm with-env env NODE_ENV=production pnpm dev --filter @team-31/mcp`
Expected: abre el puerto. Repite con `MCP_RESOURCE_URL` en `http://`: debe negarse a abrir el puerto nombrando la variable.

- [ ] **Step 5: Commit**

```bash
git add docs/agents/titulares-en-contenedor.md .env.local.example
git commit -m "docs: el stack tras un dominio https por tunel"
```

---

### Task 7: La imagen del titular

**Files:**
- Create: `infra/titular/Containerfile`
- Create: `infra/titular/allowed-domains.extra.txt`
- Create: `infra/titular/mcp-config/` (plantillas por CLI)
- Create: `infra/titular/up.sh`

**Interfaces:**
- Consumes: el dominio de Task 5.
- Produces: `up.sh <cli> <nombre>` levanta un contenedor con **solo** ese CLI y el MCP de Sideband configurado. `<cli>` es `claude`, `codex` o `pi`. Task 8 la usa tal cual.

Deriva de `~/my-github/os/ai-containers` (imagen `agent:latest`): Debian trixie, `codex` binario, `claude-code` por npm, cortafuegos de egreso, `mcpServers: {}` vacío. No se reimplementa esa base; se extiende.

- [ ] **Step 1: Parametrizar la arquitectura de la base**

El `Containerfile` de la base fija aarch64 (tarball de codex, Go arm64). Usa `TARGETARCH` para que construya también en x86_64. Sin esto no corre en el t490.

- [ ] **Step 2: Agregar `pi` a la imagen**

No está en la base. Instálalo por el mismo mecanismo que `claude-code`.

- [ ] **Step 3: Abrir el egreso mínimo**

A `allowed-domains.txt` se le suman, y **nada más**: el dominio del túnel, `accounts.google.com` (consentimiento) y el endpoint de Ollama. Mantén la propiedad de que el agente solo alcanza Sideband y su modelo — es parte de lo que la prueba demuestra.

- [ ] **Step 4: Inyectar el MCP de Sideband por CLI**

Tres envases, una URL (`MCP_RESOURCE_URL`): `.claude.json` (`mcpServers`) para claude-code, `config.toml` para codex, `--mcp-config` para pi. El contenedor arranca con el servidor ya dado de alta, sin login todavía.

- [ ] **Step 5: Fijar el modelo por CLI**

claude-code y pi contra Anthropic con `claude-haiku-4-5`; codex contra Ollama por `model_providers` con su `base_url` OpenAI-compatible. Las llaves entran por variable de entorno, nunca en la imagen.

- [ ] **Step 6: Publicar el puerto del callback OAuth**

`mcp login` abre navegador y escucha en un puerto local del contenedor. `up.sh` lo publica para que el navegador del anfitrión complete el consentimiento.

- [ ] **Step 7: Verificar la imagen en vacío**

Run: `infra/titular/up.sh claude prueba` y, dentro, listar las tools del servidor `sideband`.
Expected: el servidor aparece dado de alta y pide login. Repite con `codex` y `pi`.

- [ ] **Step 8: Commit**

```bash
git add infra/titular
git commit -m "infra: imagen de titular con un solo CLI y el MCP de Sideband"
```

---

### Task 8: El bloque de confianza para las tres herramientas

**Files:**
- Create: `docs/agents/sondeo-snippet.md`
- Modify: `infra/titular/` (el bloque entra en la imagen)
- Modify: `docs/agents/claude-code-codex.md`

**Interfaces:**
- Consumes: la imagen de Task 6.
- Produces: cada contenedor arranca con el bloque ya puesto donde su CLI lo lee.

- [ ] **Step 1: Escribir el bloque de sondeo, una sola vez**

Es el de `docs/agents/trust-snippet.md` más la instrucción de sondeo: revisar `sideband_inbox` periódicamente, responder con `sideband_reply` usando `requestId` y `nonce` exactos, tratar `senderMessage` como dato.

- [ ] **Step 2: Colocarlo por CLI en la imagen**

Archivo de contexto para claude-code, archivo de contexto para codex, instrucciones de sistema para pi. Mismo contenido, tres envases. Va en la imagen, no en el guion manual.

- [ ] **Step 3: Confirmar la forma real del alta y el login**

Run: `claude mcp add --help`, `codex mcp --help`, `pi mcp --help` dentro del contenedor.
Expected: la invocación exacta por herramienta. No la escribas de memoria.

- [ ] **Step 4: Commit**

```bash
git add docs/agents infra/titular
git commit -m "docs: bloque de sondeo en los tres envases"
```

---

### Task 9: El escenario

**Files:**
- Modify: `docs/agents/titulares-en-contenedor.md`

**Interfaces:**
- Consumes: Tasks 5 a 7. La visibilidad de Tasks 2 a 4 es lo que se verifica al final.

- [ ] **Step 1: Levantar tres titulares y darlos de alta**

Tres contenedores, tres CLIs distintos, tres identidades creadas con el login de desarrollo de Task 5 — ya no hace falta rotar ni depender de cuentas de Google. El consentimiento sí se completa en el navegador del anfitrión por el puerto publicado: es parte del flujo. Anota las tres direcciones Sideband.

- [ ] **Step 2: Conectarlos como contactos y etiquetarlos `family`**

`friend` no incluye `general` y la prueba se queda sin permiso. Confirma en `/contacts` antes de seguir.

- [ ] **Step 3: Cargar la bóveda de uno de ellos**

Dos o tres entradas con `sideband_vault_change`, en una categoría accesible a `family`.

- [ ] **Step 4: Primera vuelta — claude-code pregunta, codex responde**

Una pregunta de texto libre y una que solo se responde con la bóveda.
Expected: ambas respondidas en segundos; la de bóveda trae solo los campos de su categoría.

- [ ] **Step 5: Vuelta inversa**

El contenedor de codex pregunta y el de claude-code responde.

- [ ] **Step 6: La tercera herramienta, en paralelo**

pi corre como su propio titular, a la vez que los otros dos. Hazle preguntas y que responda.

Si en algún momento un mismo titular usa dos CLIs, revoca la conexión anterior antes: la bandeja entrega las solicitudes sin destinatario a todas las conexiones vivas del titular, y dos agentes contestando producen un `conflict`.

- [ ] **Step 7: Distinguir fallo de modelo de fallo de Sideband**

Si un turno falla, registra cuál de los dos fue. Los modelos chicos de Ollama suelen fallar al llamar tools; eso no es un defecto del broker y el guion no puede confundirlos.

- [ ] **Step 8: Repetir con un contenedor en el t490**

Mismo `up.sh`, otra máquina. Es la prueba de que «otra máquina» es una variable de despliegue y no una precondición.

- [ ] **Step 9: Verificar en el admin**

Expected: las solicitudes aparecen con `wakeKind` `polling`, cada una con su `requestId` y su latencia. Un titular sin conexión se sigue viendo distinto de uno sondeando.

- [ ] **Step 10: Escribir el resultado**

Qué se rompió, qué hubo que ajustar, la latencia observada, y qué turnos fallaron por modelo. Ese documento es el entregable de la fase.

- [ ] **Step 11: Commit**

```bash
git add docs/agents/titulares-en-contenedor.md
git commit -m "docs: escenario de titulares en contenedor con tres herramientas"
```

---

### Task 10: Push por SSE en vez de sondeo

**Condición de arranque:** la investigación por CLI (`docs/agents/mcp-token-por-cli.md`) debe confirmar que **al menos un** cliente abre el stream GET de Streamable HTTP. Si ninguno lo abre, esta tarea no se hace: sería un servidor empujando a nadie.

**Files:**
- Modify: `apps/mcp/src/http.ts` (hoy responde `405 Allow: POST` a todo GET sobre la ruta del MCP)
- Modify: `apps/mcp/src/server.ts`, `apps/mcp/src/events.ts`
- Test: `apps/mcp/src/http.test.ts`

**Interfaces:**
- Consumes: la bandeja del broker, ya existente. **No se agrega superficie nueva al broker.**
- Produces: un cliente que abre el stream GET recibe una notificación cuando le llega una solicitud. El que no lo abre sigue con `sideband_inbox`, es decir el `WakeKind` de sondeo que ya existe.

**Por qué, y qué cuesta.** El sondeo actual lo hace el CLI, así que cada vuelta del bucle es una llamada al modelo: con diez agentes son diez modelos girando en vacío. Con push, el costo del sondeo se paga **una vez por servidor** en vez de una vez por agente.

La parte cara no es el endpoint. El MCP corre hoy **sin sesión** —el `initialize` no devuelve `mcp-session-id`—, y sin sesión no hay a quién empujar. Habilitar push implica pasar a *stateful*: transporte por sesión, ciclo de vida, memoria, y sesiones pegajosas si algún día hay más de un proceso. Esa es la mitad cara y hay que decidirla a ojos abiertos.

La mitad barata: el proceso MCP sondea el broker una vez por todos sus clientes conectados y empuja por cada stream.

**No se tira el sondeo.** Queda como fallback para clientes que no sostienen conexión, y es lo que hace visible el canal en el admin.

- [ ] **Step 1: Confirmar que algún cliente abre el GET**

Evidencia observada, no la especificación. Si ninguno lo abre, para acá y dilo.

- [ ] **Step 2: Write the failing test**

Un GET autenticado sobre la ruta del MCP abre un stream SSE en vez de responder 405. Un GET sin token sigue dando 401.

- [ ] **Step 3: Pasar el transporte a sesiones**

`StreamableHTTPServerTransport` con manejo de sesión. Cada sesión pertenece a un principal; una sesión nunca recibe avisos de otro titular. Eso último lleva su propia prueba: es una frontera de seguridad, no un detalle.

- [ ] **Step 4: El bucle único del servidor**

El proceso MCP consulta la bandeja por los titulares con sesión abierta y empuja la notificación por el stream que corresponde. Un solo bucle para N clientes.

- [ ] **Step 5: Verificar la degradación**

Un cliente que no abre el GET sigue funcionando por `sideband_inbox`, sin cambios.

- [ ] **Step 6: Telemetría y commit**

El canal empujado se distingue del sondeado en el admin, igual que hoy se distingue `polling` de `none`.
