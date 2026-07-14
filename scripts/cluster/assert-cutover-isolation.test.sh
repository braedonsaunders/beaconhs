#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
subject="${script_dir}/assert-cutover-isolation.sh"
fixtures="${script_dir}/test-fixtures/cutover-isolation.json"
mock_bin="$(mktemp -d)"
trap 'rm -rf "$mock_bin"' EXIT
ln -s "${script_dir}/test-fixtures/mock-docker.sh" "${mock_bin}/docker"

run_fixture() {
  local fixture expected_status expected_message writers_drained output status
  fixture="$1"
  expected_status="$2"
  expected_message="$3"
  writers_drained="${4:-false}"
  status=0
  output="$({
    PATH="${mock_bin}:$PATH" \
      CUTOVER_ISOLATION_FIXTURES="$fixtures" \
      CUTOVER_ISOLATION_FIXTURE="$fixture" \
      DOKPLOY_TARGET_STACK=beaconhs \
      IMAGE_NAME=ghcr.io/braedonsaunders/beaconhs \
      DATABASE_URL='postgres://runtime:runtime-secret@db.internal:5432/beaconhs?sslmode=require' \
      SUPERADMIN_DATABASE_URL='postgresql://super:super-secret@db.internal:5432/beaconhs?sslmode=require' \
      MIGRATION_DATABASE_URL='postgresql://migrator:migration-secret@db.internal:5432/beaconhs?sslmode=require' \
      BEACONHS_CUTOVER_WRITERS_DRAINED="$writers_drained" \
      "$subject"
  } 2>&1)" || status=$?

  if [ "$expected_status" = success ] && [ "$status" -ne 0 ]; then
    echo "Fixture ${fixture} unexpectedly failed:" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
  if [ "$expected_status" = failure ] && [ "$status" -eq 0 ]; then
    echo "Fixture ${fixture} unexpectedly passed" >&2
    return 1
  fi
  if ! grep -Fq "$expected_message" <<<"$output"; then
    echo "Fixture ${fixture} did not emit its expected diagnostic:" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
  echo "PASS ${fixture} (${expected_status})"
}

run_fixture safe success \
  'Verified that no external Swarm service or standalone container can write to the cutover target'
run_fixture safe failure \
  'Running Docker writer or target-database container detected after writer drain' true
run_fixture drained-safe success \
  'Verified that no running Docker container can write to the drained cutover target' true
run_fixture external-migrator failure \
  'External Swarm writer or target-database service detected during cutover'
run_fixture spoofed-swarm-label failure \
  'Standalone Docker writer or target-database container detected during cutover'
run_fixture alternate-equivalent-url failure \
  'Standalone Docker writer or target-database container detected during cutover'
run_fixture libpq-environment failure \
  'Standalone Docker writer or target-database container detected during cutover'
run_fixture multi-node failure \
  'Cutover isolation requires exactly one Swarm node'

status=0
output="$({
  PATH="${mock_bin}:$PATH" \
    CUTOVER_ISOLATION_FIXTURES="$fixtures" \
    CUTOVER_ISOLATION_FIXTURE=safe \
    DOKPLOY_TARGET_STACK=beaconhs \
    IMAGE_NAME=ghcr.io/braedonsaunders/beaconhs \
    DATABASE_URL='postgres://runtime@db.internal/beaconhs' \
    SUPERADMIN_DATABASE_URL='postgres://super@db.internal/beaconhs' \
    "$subject"
} 2>&1)" || status=$?
if [ "$status" -eq 0 ] || ! grep -Fq 'MIGRATION_DATABASE_URL is required' <<<"$output"; then
  echo 'Missing MIGRATION_DATABASE_URL did not fail closed' >&2
  printf '%s\n' "$output" >&2
  exit 1
fi
echo 'PASS missing-migration-credential (failure)'
