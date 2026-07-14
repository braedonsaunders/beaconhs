#!/usr/bin/env bash

set -euo pipefail

: "${DOKPLOY_TOKEN:?DOKPLOY_TOKEN is required}"

if ! command -v curl >/dev/null 2>&1; then
  echo 'curl is required for Dokploy API requests' >&2
  exit 1
fi

token="$DOKPLOY_TOKEN"
unset DOKPLOY_TOKEN
case "$token" in
  *$'\r'* | *$'\n'*)
    echo 'DOKPLOY_TOKEN must not contain a line break' >&2
    exit 1
    ;;
esac

temp_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
header_file="$(mktemp "${temp_dir%/}/beaconhs-dokploy-header.XXXXXX")"
cleanup() {
  rm -f -- "$header_file"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

chmod 0600 "$header_file"
printf 'x-api-key: %s\n' "$token" > "$header_file"
unset token

curl -H @"$header_file" "$@"
