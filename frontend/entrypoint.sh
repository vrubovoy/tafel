#!/bin/sh
set -eu

tmp="$(mktemp /config/config.js.tmp.XXXXXX)"
trap 'rm -f "$tmp"' EXIT HUP INT TERM

{
  printf 'window.__HOF_CONFIG__ = '
  jq -cn \
    --arg schlusselUrl "${SCHLUSSEL_WEB_URL:-http://localhost:4001}" \
    --arg schlossUrl "${SCHLOSS_URL:-http://localhost:3000}" \
    --arg glockeUrl "${GLOCKE_URL:-http://localhost:5177}" \
    --argjson glockeEnabled "$([ -n "${GLOCKE_URL:-}" ] && echo true || echo false)" \
    '{schemaVersion: 1, $schlusselUrl, $schlossUrl, $glockeUrl, services: {glocke: $glockeEnabled}}'
  printf ';\n'
} > "$tmp"

mv "$tmp" /config/config.js
trap - EXIT HUP INT TERM
exec "$@"
