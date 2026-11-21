#!/usr/bin/env bash
# Corre la demo, los tests o la carga en un stack Docker efímero y aislado; lo borra al terminar.
#   scripts/docker.sh demo [N]                demo MCP con N participantes (default 3)
#   scripts/docker.sh test                    tests de todos los paquetes + demo + humo de carga
#   scripts/docker.sh scale <escenario> [...] carga + invariantes (args de apps/scale/src/run.mjs)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mode="${1:-}"
case "$mode" in
  demo|test|scale) shift ;;
  *) echo "Uso: scripts/docker.sh demo [N] | test | scale <escenario> [--agents N] [--mcp [K]] ..." >&2; exit 2 ;;
esac

project="team31-${mode}-$$"
compose() {
  # Los servicios de los perfiles nexo/demo-model no corren aquí, pero Compose interpola
  # todo el archivo: valores de relleno para que no falte ningún puerto (el override los anula).
  BROKER_PORT=1 MCP_PORT=1 ADMIN_PORT=1 DEMO_MODEL_PORT=1 \
  docker compose -p "$project" -f docker-compose.yml -f infra/docker/compose.isolated.yml \
    --profile demo --profile test --profile scale "$@"
}
trap 'compose down -v --remove-orphans >/dev/null 2>&1 || true' EXIT

# Carga: resultados JSON (del runner) y muestras de `docker stats` en .scale-results/.
scale() {
  mkdir -p .scale-results
  export SCALE_UID SCALE_GID SCALE_RUN_ID
  SCALE_UID="$(id -u)" SCALE_GID="$(id -g)" SCALE_RUN_ID="${1:-smoke}-$(date +%Y%m%d-%H%M%S)"
  compose up -d --wait coordination
  local stats=".scale-results/${SCALE_RUN_ID}.docker-stats.tsv" status=0
  (
    while :; do
      ids="$(docker ps -q --filter "label=com.docker.compose.project=$project")"
      [ -n "$ids" ] && docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' $ids >>"$stats" 2>/dev/null
      sleep 1
    done
  ) &
  local sampler=$!
  compose run --rm scale "$@" || status=$?
  kill "$sampler" 2>/dev/null || true
  wait "$sampler" 2>/dev/null || true
  if [ -s "$stats" ]; then
    echo "docker stats (muestras cada ~2 s; promedio incluye tiempo ocioso):"
    awk -F'\t' -v p="$project-" '
      { n=$1; sub(p, "", n); sub(/-run-.*/, "-run", n); c=$2; sub(/%/, "", c)
        split($3, m, " "); v=m[1]; f=1
        if (v ~ /GiB/) f=1024; else if (v ~ /KiB|kB/) f=1/1024
        gsub(/[A-Za-z]/, "", v); v*=f
        k[n]++; s[n]+=c; if (c+0 > x[n]) x[n]=c+0; if (v > mm[n]) mm[n]=v }
      END { printf "  %-16s %9s %9s %10s\n", "contenedor", "cpu_avg%", "cpu_max%", "mem_max"
            for (n in k) printf "  %-16s %9.0f %9.0f %7.0fMiB\n", n, s[n]/k[n], x[n], mm[n] }' "$stats"
  fi
  echo "Resultados en el host: .scale-results/${SCALE_RUN_ID}.json (+ .docker-stats.tsv)"
  return "$status"
}

compose build coordination
case "$mode" in
  test)
    # Los tests usan app_test y la demo/carga usan app: corren en paralelo sobre el mismo Postgres.
    compose up -d --wait coordination
    compose run --rm test > >(sed -u 's/^/[test] /') 2>&1 &
    tests=$!
    status=0
    { compose run --rm demo 3 && scale smoke; } || status=$?
    wait "$tests" || status=$?
    exit "$status"
    ;;
  demo) compose run --rm demo "${1:-3}" ;;
  scale)
    [ $# -ge 1 ] || { echo "Falta el escenario: $(ls apps/scale/scenarios | sed 's/\.json$//' | tr '\n' ' ')" >&2; exit 2; }
    scale "$@"
    ;;
esac
