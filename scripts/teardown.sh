#!/usr/bin/env bash
# Baja el stack docker de este worktree (borra sus datos) y libera su slot.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
REGISTRY="$(git rev-parse --path-format=absolute --git-common-dir)/team31-slots"
cd "$ROOT"
docker compose down -v --remove-orphans || true
[ -f "$REGISTRY" ] && { grep -v " $ROOT\$" "$REGISTRY" >"$REGISTRY.tmp" || true; mv "$REGISTRY.tmp" "$REGISTRY"; }
rm -f .env
echo "✔ worktree liberado"
