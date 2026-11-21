#!/usr/bin/env bash
# build.sh — construye la imagen del titular. El contexto es infra/titular/ (ver .dockerignore).
#
#   ./infra/titular/build.sh                 # arquitectura de esta máquina
#   TITULAR_PLATFORM=linux/amd64 ./infra/titular/build.sh   # la otra máquina del proyecto

set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
IMAGEN="${TITULAR_IMAGE:-sideband-titular:latest}"

args=(build -t "${IMAGEN}" -f "${AQUI}/Containerfile")
[[ -n "${TITULAR_PLATFORM:-}" ]] && args+=(--platform "${TITULAR_PLATFORM}")

exec docker "${args[@]}" "${AQUI}"
