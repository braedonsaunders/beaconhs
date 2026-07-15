#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
subject="${script_dir}/assert-cutover-isolation.sh"
fixtures="${script_dir}/test-fixtures/cutover-isolation.json"
mock_bin="$(mktemp -d)"
trap 'rm -rf "$mock_bin"' EXIT
ln -s "${script_dir}/test-fixtures/mock-docker.sh" "${mock_bin}/docker"

run_fixture() {
  local fixture expected_status expected_message writers_drained
  local materialized_pending_writers mock_state output status
  fixture="$1"
  expected_status="$2"
  expected_message="$3"
  writers_drained="${4:-false}"
  materialized_pending_writers="${5:-false}"
  mock_state="${mock_bin}/state-${fixture}"
  rm -f "$mock_state"
  status=0
  output="$({
    PATH="${mock_bin}:$PATH" \
      CUTOVER_ISOLATION_FIXTURES="$fixtures" \
      CUTOVER_ISOLATION_FIXTURE="$fixture" \
      CUTOVER_ISOLATION_MOCK_STATE="$mock_state" \
      DOKPLOY_TARGET_STACK=beaconhs \
      IMAGE_NAME=ghcr.io/braedonsaunders/beaconhs \
      DATABASE_URL='postgres://runtime:runtime-secret@db.internal:5432/beaconhs?sslmode=require' \
      SUPERADMIN_DATABASE_URL='postgresql://super:super-secret@db.internal:5432/beaconhs?sslmode=require' \
      MIGRATION_DATABASE_URL='postgresql://migrator:migration-secret@db.internal:5432/beaconhs?sslmode=require' \
      BEACONHS_CUTOVER_WRITERS_DRAINED="$writers_drained" \
      BEACONHS_CUTOVER_MATERIALIZED_PENDING_WRITERS="$materialized_pending_writers" \
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
  'Verified that no external Swarm service or deployment-manager standalone container can write to the cutover target'
run_fixture safe failure \
  'A target writer task remains nonterminal somewhere in the Swarm after writer drain' true
run_fixture drained-safe success \
  'Verified that no running Docker container can write to the drained cutover target' true
run_fixture external-migrator failure \
  'External Swarm writer or target-database service detected during cutover'
run_fixture spoofed-swarm-label failure \
  'Deployment-manager standalone writer or target-database container detected during cutover'
run_fixture alternate-equivalent-url failure \
  'Deployment-manager standalone writer or target-database container detected during cutover'
run_fixture libpq-environment failure \
  'Deployment-manager standalone writer or target-database container detected during cutover'
run_fixture multi-node success \
  'Verified that no external Swarm service or deployment-manager standalone container can write to the cutover target'
run_fixture local-worker failure \
  'The deployment runner must use a reachable Swarm manager'
run_fixture unreachable-local-manager failure \
  'Every Swarm manager must be reachable before cutover'
run_fixture multiple-leaders failure \
  'Swarm must have exactly one reachable manager leader before cutover'
run_fixture unhealthy-node failure \
  'Every Swarm node must be ready before cutover'
run_fixture drained-remote-writer failure \
  'A target writer task remains nonterminal somewhere in the Swarm after writer drain' true
run_fixture materialized-safe failure \
  'A target writer task remains nonterminal somewhere in the Swarm after writer drain' true
run_fixture materialized-safe success \
  'Verified that no running Docker container can write to the drained cutover target' true true
run_fixture materialized-pending-assigned failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-pending-container-backed failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-assigned failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-preparing failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-starting failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-running failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-duplicate-current failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-nonterminal-history failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-task-transition failure \
  'Materialized target writer task state changed during the cutover-isolation check' true true
run_fixture materialized-task-generation-change failure \
  'The materialized target writer task set changed during the cutover-isolation check' true true
run_fixture materialized-active-node failure \
  'Materialized pending writers require every Swarm node to remain unavailable for scheduling' true true
run_fixture materialized-drained-node success \
  'Verified that no running Docker container can write to the drained cutover target' true true
run_fixture materialized-missing-current-role failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-no-tasks failure \
  'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history' true true
run_fixture materialized-missing-writer-service failure \
  'Materialized pending-writer phase requires exactly the canonical web, worker, and scheduler services' true true
run_fixture materialized-safe failure \
  'Materialized pending writers are valid only after target writers have been drained' false true

status=0
output="$({
  PATH="${mock_bin}:$PATH" \
    CUTOVER_ISOLATION_FIXTURES="$fixtures" \
    CUTOVER_ISOLATION_FIXTURE=safe \
    DOKPLOY_TARGET_STACK=beaconhs \
    IMAGE_NAME=ghcr.io/braedonsaunders/beaconhs \
    DATABASE_URL='postgres://runtime@db.internal/beaconhs' \
    SUPERADMIN_DATABASE_URL='postgres://super@db.internal/beaconhs' \
    MIGRATION_DATABASE_URL='' \
    "$subject"
} 2>&1)" || status=$?
if [ "$status" -eq 0 ] || ! grep -Fq 'MIGRATION_DATABASE_URL is required' <<<"$output"; then
  echo 'Missing MIGRATION_DATABASE_URL did not fail closed' >&2
  printf '%s\n' "$output" >&2
  exit 1
fi
echo 'PASS missing-migration-credential (failure)'

status=0
output="$({
  PATH="${mock_bin}:$PATH" \
    CUTOVER_ISOLATION_FIXTURES="$fixtures" \
    CUTOVER_ISOLATION_FIXTURE=materialized-safe \
    DOKPLOY_TARGET_STACK=beaconhs \
    IMAGE_NAME=ghcr.io/braedonsaunders/beaconhs \
    DATABASE_URL='postgres://runtime@db.internal/beaconhs' \
    SUPERADMIN_DATABASE_URL='postgres://super@db.internal/beaconhs' \
    MIGRATION_DATABASE_URL='postgres://migrator@db.internal/beaconhs' \
    BEACONHS_CUTOVER_WRITERS_DRAINED=true \
    BEACONHS_CUTOVER_MATERIALIZED_PENDING_WRITERS=invalid \
    "$subject"
} 2>&1)" || status=$?
if [ "$status" -eq 0 ] \
  || ! grep -Fq 'BEACONHS_CUTOVER_MATERIALIZED_PENDING_WRITERS must be exactly true or false' <<<"$output"; then
  echo 'Invalid materialized-pending-writers phase did not fail closed' >&2
  printf '%s\n' "$output" >&2
  exit 1
fi
echo 'PASS invalid-materialized-pending-writers-phase (failure)'
