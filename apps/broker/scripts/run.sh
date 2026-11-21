#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="$(node scripts/prepare-db.mjs --print-url)"
export DATABASE_URL
unset BROKER_DATABASE_PASSWORD
exec "$@"
