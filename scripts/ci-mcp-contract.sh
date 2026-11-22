#!/usr/bin/env bash
set -euo pipefail

export DATABASE_URL="" TELEMETRY_SINK=off MCP_DEV_AUTH=1 E2E_AUTH_MODE=dev WAKE_ALLOW_INSECURE=1
export BROKER_HOST=127.0.0.1 MCP_HOST=127.0.0.1 E2E_MCP_URL="${MCP_RESOURCE_URL:?}"
export WAKE_RETRY_DELAYS_MS=0,0

run_contract_tests() (
  export REQUEST_TTL_SECONDS="$1"
  shift
  node apps/broker/dist/index.js &
  broker_pid=$!
  node apps/mcp/dist/index.js &
  mcp_pid=$!
  cleanup() {
    kill "$broker_pid" "$mcp_pid" 2>/dev/null || true
    wait "$broker_pid" "$mcp_pid" 2>/dev/null || true
  }
  trap cleanup EXIT

  for health in "${BROKER_URL:?}/healthz" "${MCP_RESOURCE_URL%/mcp}/healthz"; do
    for ((attempt=0; attempt<50; attempt++)); do
      kill -0 "$broker_pid" "$mcp_pid" || exit 1
      if curl -fs --max-time 1 "$health" >/dev/null; then break; fi
      sleep 0.2
    done
    curl -fsS --max-time 2 "$health" >/dev/null
  done
  pnpm --filter @team-31/e2e test "$@"
)

run_contract_tests 20 src/contract.test.ts src/blocks.test.ts src/closure.test.ts
run_contract_tests 120 src/isolation.test.ts
