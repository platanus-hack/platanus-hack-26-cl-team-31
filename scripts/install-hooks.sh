#!/bin/sh
# Activa los hooks versionados de .githooks/ (corre en `pnpm install` vía `prepare`).
# La config vive en el repo compartido y la ruta es relativa: cada worktree usa sus propios hooks.
# No pisa un core.hooksPath distinto que ya tengas configurado.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
current="$(git config --get core.hooksPath || true)"
if [ -z "$current" ]; then
  git config core.hooksPath .githooks && echo "hooks de git activados (.githooks/)"
elif [ "$current" != ".githooks" ]; then
  echo "core.hooksPath ya apunta a '$current': no se activan los hooks de .githooks/" >&2
fi
exit 0
