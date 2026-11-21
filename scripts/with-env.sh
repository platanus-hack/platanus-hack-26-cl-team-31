#!/usr/bin/env bash
# Ejecuta un comando con .env y .env.local de la raíz exportados.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
[ -f "$ROOT/.env" ] || { echo "Falta .env — corre: pnpm bootstrap" >&2; exit 1; }
set -a
. "$ROOT/.env"
[ -f "$ROOT/.env.local" ] && . "$ROOT/.env.local"
set +a
exec "$@"
