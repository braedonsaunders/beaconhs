#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_API_URL:?GITHUB_API_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_REF:?GITHUB_REF is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"

github_token="$GITHUB_TOKEN"
unset GITHUB_TOKEN
case "$github_token" in
  *$'\r'* | *$'\n'*)
    echo "::error::GITHUB_TOKEN must not contain a line break"
    exit 1
    ;;
esac

if [ "$GITHUB_REF" != refs/heads/main ]; then
  echo "::error::Deployment operations may run only from refs/heads/main"
  exit 1
fi
if ! [[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::GITHUB_SHA is not a canonical full Git commit SHA"
  exit 1
fi

temp_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
header_file=''
response=''
cleanup() {
  [ -z "$header_file" ] || rm -f -- "$header_file"
  [ -z "$response" ] || rm -f -- "$response"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

header_file="$(mktemp "${temp_dir%/}/beaconhs-github-header.XXXXXX")"
response="$(mktemp "${temp_dir%/}/beaconhs-github-response.XXXXXX")"
chmod 0600 "$header_file" "$response"
printf 'authorization: Bearer %s\n' "$github_token" > "$header_file"
unset github_token

# The self-hosted Dokploy runner's curl predates --retry-all-errors. Portable
# retries still cover transient HTTP failures; every transport failure remains
# fail-closed below.
if ! curl -sS --fail --connect-timeout 5 --max-time 20 \
  --retry 2 --retry-delay 2 --retry-max-time 30 \
  -o "$response" \
  -H @"$header_file" \
  -H 'accept: application/vnd.github+json' \
  -H 'x-github-api-version: 2022-11-28' \
  "${GITHUB_API_URL%/}/repos/${GITHUB_REPOSITORY}/git/ref/heads/main"; then
  echo "::error::Unable to resolve the current remote main tip; refusing a stale or unverifiable deployment"
  exit 1
fi

remote_sha="$(jq -er '.object.sha | select(type == "string" and test("^[0-9a-f]{40}$"))' "$response")" \
  || {
    echo "::error::GitHub returned an invalid main-branch ref payload"
    exit 1
  }
if [ "$remote_sha" != "$GITHUB_SHA" ]; then
  echo "::error::This workflow SHA is no longer the current remote main tip; dispatch a new run for the latest main commit"
  exit 1
fi

echo "Verified that this workflow SHA is the current remote main tip"
