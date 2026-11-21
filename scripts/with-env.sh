#!/usr/bin/env bash
# Ejecuta un comando con .env y .env.local de la raíz exportados.
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
if [ "${1:-}" = "--optional-env" ]; then
  shift
elif [ ! -f "$ROOT/.env" ]; then
  echo "Falta .env — corre: pnpm bootstrap" >&2
  exit 1
fi
set -a
if [ -f "$ROOT/.env" ]; then
  . "$ROOT/.env"
fi
if [ -f "$ROOT/.env.local" ]; then
  . "$ROOT/.env.local"
fi
set +a
exec "$@"
