#!/usr/bin/env bash
# CI: deja en .turbo/cache solo las entradas de las tareas de esta corrida, según los resúmenes
# de `turbo run --summarize` (.turbo/runs/*.json). Así la caché que guarda actions/cache no crece
# con cada commit. Las tareas que fallaron no se cachean y quedan fuera solas.
set -euo pipefail
shopt -s nullglob
cache="${1:-.turbo/cache}"
summaries=(.turbo/runs/*.json)
[ ${#summaries[@]} -gt 0 ] && [ -d "$cache" ] || exit 0
keep="$(mktemp)"
jq -r '.tasks[].hash' "${summaries[@]}" | sort -u >"$keep"
for f in "$cache"/*; do
  h="${f##*/}"; h="${h%%[-.]*}" # <hash>.tar.zst, <hash>-meta.json, <hash>-manifest.json
  grep -qxF "$h" "$keep" || rm -f "$f"
done
rm -f "$keep"
du -sh "$cache"
