#!/usr/bin/env bash
# Corre lint + typecheck + test solo en los paquetes que cambiaron respecto de origin/main
# (y en los que dependen de ellos). Lo usa el hook pre-push; también sirve a mano:
#   pnpm check:affected
# Variables: SKIP_HOOKS=1 lo omite · CHECK_BASE=<ref> cambia la base (default origin/main)
#            CHECK_ALL=1 verifica todo el monorepo.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

say() { printf '\033[1;36m[check]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[check]\033[0m %s\n' "$*" >&2; }
BYPASS="Para saltarlo: git push --no-verify (o SKIP_HOOKS=1 git push)."

if [ "${SKIP_HOOKS:-}" = 1 ]; then
  say "SKIP_HOOKS=1: se omite la verificación."
  exit 0
fi

TURBO="$ROOT/node_modules/.bin/turbo"
if [ ! -x "$TURBO" ]; then
  fail "No encuentro turbo en node_modules: corre 'pnpm install' (o 'pnpm bootstrap'). $BYPASS"
  exit 1
fi

# Archivos de la raíz que afectan a todos los paquetes: si cambian, se verifica todo.
GLOBAL_RE='^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|vitest\.shared\.ts|\.nvmrc|\.npmrc|scripts/with-env\.sh|infra/postgres/)'

base="${CHECK_BASE:-origin/main}"
all="${CHECK_ALL:-}"
reason=""
if [ -n "$all" ]; then
  reason="CHECK_ALL=1"
elif ! git rev-parse -q --verify "$base^{commit}" >/dev/null; then
  all=1
  reason="no existe '$base' (corre 'git fetch origin' para verificar solo lo afectado)"
elif ! mb="$(git merge-base "$base" HEAD)"; then
  all=1
  reason="'$base' y HEAD no tienen ancestro común"
else
  # Cambios del working tree (commits, staged, sin stage y archivos nuevos) contra el merge-base.
  changed="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard; } | sort -u)"
  if [ -z "$changed" ]; then
    say "Sin cambios respecto de $base ($(git rev-parse --short "$mb")): nada que verificar."
    exit 0
  fi
  if global="$(grep -E "$GLOBAL_RE" <<<"$changed" | head -3)" && [ -n "$global" ]; then
    all=1
    reason="cambió configuración global ($(tr '\n' ' ' <<<"$global" | sed 's/ $//'))"
  fi
fi

filter=()
if [ -n "$all" ]; then
  say "Se verifica TODO el monorepo: $reason."
else
  filter=("--filter=...[$mb]")
  pkgs="$("$TURBO" ls "${filter[@]}" 2>/dev/null | sed -n 's/^  \(@[^ ]*\) .*/\1/p')"
  if [ -z "$pkgs" ]; then
    say "Solo cambiaron archivos fuera de los paquetes (docs, scripts…): nada que verificar."
    exit 0
  fi
  say "Base: $base @ $(git rev-parse --short "$mb"). Paquetes afectados (y sus dependientes):"
  sed 's/^/          /' <<<"$pkgs" >&2
fi

# Los tests de Postgres usan TEST_DATABASE_URL del .env de este worktree.
if [ -f "$ROOT/.env" ]; then
  if ! "$ROOT/scripts/with-env.sh" node -e '
    if (!process.env.TEST_DATABASE_URL) process.exit(0);
    const u = URL.parse(process.env.TEST_DATABASE_URL);
    if (!u?.hostname) process.exit(1);
    const s = require("node:net").connect({ host: u.hostname, port: Number(u.port || 5432) });
    s.setTimeout(1500);
    s.on("connect", () => process.exit(0)).on("error", () => process.exit(1)).on("timeout", () => process.exit(1));
  '; then
    fail "No se pudo conectar a Postgres. Revisa TEST_DATABASE_URL en este worktree."
    fail "Levántalo con 'pnpm infra:up' (o 'pnpm bootstrap') y vuelve a intentar. $BYPASS"
    exit 1
  fi
else
  say "Sin .env (no corriste 'pnpm bootstrap'): los tests de Postgres se omitirán."
fi

cmd=("$TURBO" run lint typecheck test ${filter[@]+"${filter[@]}"} --continue --output-logs=errors-only --ui=stream)
say "Corre: turbo run lint typecheck test ${filter[*]:+${filter[*]} }--continue (lo que no cambió sale de la caché de turbo)"
start=$(date +%s)
if "$ROOT/scripts/with-env.sh" --optional-env "${cmd[@]}"; then
  say "OK en $(($(date +%s) - start)) s."
else
  fail "Falló la verificación ($(($(date +%s) - start)) s). Revisa los errores de arriba. $BYPASS"
  exit 1
fi
