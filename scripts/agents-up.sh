#!/usr/bin/env bash
# From a fresh checkout to a listening API and one client config per participant.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm bootstrap
pnpm --filter @team-31/server run build
pnpm agents:seed "$@"
exec ./scripts/with-env.sh node apps/server/dist/index.js
