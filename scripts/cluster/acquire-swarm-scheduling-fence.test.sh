#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
subject="${script_dir}/acquire-swarm-scheduling-fence.sh"
assertion="${script_dir}/assert-swarm-scheduling-paused.sh"
release="${script_dir}/release-swarm-scheduling-fence.sh"
test_root="$(mktemp -d)"
mock_bin="${test_root}/bin"
mkdir -p "$mock_bin"
trap 'rm -rf "$test_root"' EXIT

cat > "${mock_bin}/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
: "${MOCK_SWARM_LABELS:?MOCK_SWARM_LABELS is required}"
: "${MOCK_SWARM_STATE:?MOCK_SWARM_STATE is required}"

case "${1:-} ${2:-}" in
  "node ls")
    if [ "${MOCK_NODE_LS_TITLECASE:-}" = true ]; then
      awk -F'\t' -v OFS='\t' '{ $2 = toupper(substr($2, 1, 1)) substr($2, 2); print }' \
        "$MOCK_SWARM_STATE"
    else
      cat "$MOCK_SWARM_STATE"
    fi
    ;;
  "node inspect")
    node="${@: -1}"
    if [[ "$*" == *'{{json .Spec.Labels}}'* ]]; then
      jq -c --arg node "$node" '.[$node] // null' "$MOCK_SWARM_LABELS"
    else
      awk -F'\t' -v node="$node" '$1 == node { print $2; found = 1 }
        END { if (!found) exit 1 }' "$MOCK_SWARM_STATE"
    fi
    ;;
  "node update")
    shift 2
    node="${@: -1}"
    availability=''
    phase=''
    removing=false
    declare -a additions removals
    additions=()
    removals=()
    while [ "$#" -gt 1 ]; do
      case "$1" in
        --label-add)
          assignment="${2:?label assignment is required}"
          additions+=("$assignment")
          if [[ "$assignment" == com.beaconhs.deploy.scheduler-fence.phase=* ]]; then
            phase="${assignment#*=}"
          fi
          shift 2
          ;;
        --label-rm)
          removals+=("${2:?label key is required}")
          removing=true
          shift 2
          ;;
        --availability)
          availability="${2:?availability is required}"
          shift 2
          ;;
        *) exit 98 ;;
      esac
    done
    [ "$1" = "$node" ] || exit 97

    if [ "$phase" = claiming ] && [ "$node" = "${MOCK_SWARM_FAIL_CLAIM_NODE:-}" ] \
      && [ -f "${MOCK_SWARM_FAIL_CLAIM_ONCE:-/nonexistent}" ]; then
      rm -f "$MOCK_SWARM_FAIL_CLAIM_ONCE"
      exit 75
    fi
    if [ "$availability" = pause ] && [ "$node" = "${MOCK_SWARM_FAIL_PAUSE_NODE:-}" ] \
      && [ -f "${MOCK_SWARM_FAIL_PAUSE_ONCE:-/nonexistent}" ]; then
      rm -f "$MOCK_SWARM_FAIL_PAUSE_ONCE"
      exit 75
    fi
    if [ "$availability" = active ] && [ "$node" = "${MOCK_SWARM_FAIL_ACTIVE_NODE:-}" ] \
      && [ -f "${MOCK_SWARM_FAIL_ACTIVE_ONCE:-/nonexistent}" ]; then
      rm -f "$MOCK_SWARM_FAIL_ACTIVE_ONCE"
      exit 75
    fi
    if [ "$removing" = true ] && [ "$node" = "${MOCK_SWARM_FAIL_REMOVE_NODE:-}" ] \
      && [ -f "${MOCK_SWARM_FAIL_REMOVE_ONCE:-/nonexistent}" ]; then
      rm -f "$MOCK_SWARM_FAIL_REMOVE_ONCE"
      exit 75
    fi

    labels="$(jq -c --arg node "$node" '.[$node] // {}' "$MOCK_SWARM_LABELS")"
    for assignment in "${additions[@]}"; do
      key="${assignment%%=*}"
      value="${assignment#*=}"
      labels="$(jq -c --arg key "$key" --arg value "$value" '.[$key] = $value' <<< "$labels")"
    done
    for key in "${removals[@]}"; do
      labels="$(jq -c --arg key "$key" 'del(.[$key])' <<< "$labels")"
    done
    next="${MOCK_SWARM_LABELS}.next"
    jq -c --arg node "$node" --argjson labels "$labels" '.[$node] = $labels' \
      "$MOCK_SWARM_LABELS" > "$next"
    mv "$next" "$MOCK_SWARM_LABELS"

    if [ -n "$availability" ]; then
      next="${MOCK_SWARM_STATE}.next"
      awk -F'\t' -v OFS='\t' -v node="$node" -v availability="$availability" '
        $1 == node { $2 = availability; found = 1 }
        { print }
        END { if (!found) exit 1 }
      ' "$MOCK_SWARM_STATE" > "$next"
      mv "$next" "$MOCK_SWARM_STATE"
    fi
    ;;
  *)
    echo "Unexpected docker command: $*" >&2
    exit 99
    ;;
esac
MOCK
chmod 0700 "${mock_bin}/docker"

new_case() {
  case_dir="$(mktemp -d "${test_root}/case.XXXXXX")"
  runner_temp="${case_dir}/runner-temp"
  github_env="${case_dir}/github-env"
  swarm_state="${case_dir}/swarm.tsv"
  swarm_labels="${case_dir}/labels.json"
  mkdir -p "$runner_temp"
  : > "$github_env"
  printf '{}\n' > "$swarm_labels"
}

run_acquire() {
  PATH="${mock_bin}:$PATH" \
    MOCK_SWARM_LABELS="$swarm_labels" \
    MOCK_SWARM_STATE="$swarm_state" \
    MOCK_NODE_LS_TITLECASE="${MOCK_NODE_LS_TITLECASE:-}" \
    MOCK_SWARM_FAIL_CLAIM_NODE="${MOCK_SWARM_FAIL_CLAIM_NODE:-}" \
    MOCK_SWARM_FAIL_CLAIM_ONCE="${MOCK_SWARM_FAIL_CLAIM_ONCE:-}" \
    MOCK_SWARM_FAIL_PAUSE_NODE="${MOCK_SWARM_FAIL_PAUSE_NODE:-}" \
    MOCK_SWARM_FAIL_PAUSE_ONCE="${MOCK_SWARM_FAIL_PAUSE_ONCE:-}" \
    RUNNER_TEMP="$runner_temp" \
    GITHUB_ENV="$github_env" \
    GITHUB_REPOSITORY='braedonsaunders/beaconhs-platform' \
    DOKPLOY_TARGET_STACK='beaconhs' \
    "$subject"
}

fence_env() {
  export BEACONHS_SWARM_NODE_STATE_FILE="${runner_temp}/beaconhs-swarm-original-node-state.tsv"
  export BEACONHS_SWARM_FENCE_NODE_SET_SHA256
  BEACONHS_SWARM_FENCE_NODE_SET_SHA256="$(sha256sum "$BEACONHS_SWARM_NODE_STATE_FILE" | awk '{print $1}')"
}

run_assertion() {
  fence_env
  PATH="${mock_bin}:$PATH" \
    MOCK_SWARM_LABELS="$swarm_labels" \
    MOCK_SWARM_STATE="$swarm_state" \
    MOCK_NODE_LS_TITLECASE="${MOCK_NODE_LS_TITLECASE:-}" \
    RUNNER_TEMP="$runner_temp" \
    GITHUB_REPOSITORY='braedonsaunders/beaconhs-platform' \
    DOKPLOY_TARGET_STACK='beaconhs' \
    "$assertion"
}

run_release() {
  fence_env
  PATH="${mock_bin}:$PATH" \
    MOCK_SWARM_LABELS="$swarm_labels" \
    MOCK_SWARM_STATE="$swarm_state" \
    MOCK_SWARM_FAIL_ACTIVE_NODE="${MOCK_SWARM_FAIL_ACTIVE_NODE:-}" \
    MOCK_SWARM_FAIL_ACTIVE_ONCE="${MOCK_SWARM_FAIL_ACTIVE_ONCE:-}" \
    MOCK_SWARM_FAIL_REMOVE_NODE="${MOCK_SWARM_FAIL_REMOVE_NODE:-}" \
    MOCK_SWARM_FAIL_REMOVE_ONCE="${MOCK_SWARM_FAIL_REMOVE_ONCE:-}" \
    RUNNER_TEMP="$runner_temp" \
    GITHUB_ENV="$github_env" \
    GITHUB_REPOSITORY='braedonsaunders/beaconhs-platform' \
    DOKPLOY_TARGET_STACK='beaconhs' \
    "$release"
}

assert_all_phase() {
  jq -e 'length == 3 and all(.[];
    .["com.beaconhs.deploy.scheduler-fence.version"] == "2"
      and .["com.beaconhs.deploy.scheduler-fence.phase"] == "paused")' \
    "$swarm_labels" >/dev/null
}

new_case
printf 'node-c\tactive\nnode-a\tactive\nnode-b\tactive\n' > "$swarm_state"
run_acquire >/dev/null
[ "$(cut -f2 "$swarm_state" | LC_ALL=C sort -u)" = pause ]
assert_all_phase
MOCK_NODE_LS_TITLECASE=true run_assertion >/dev/null
grep -Fq 'BEACONHS_SWARM_FENCE_NODE_SET_SHA256=' "$github_env"
run_release >/dev/null
[ "$(cut -f2 "$swarm_state" | LC_ALL=C sort -u)" = active ]
jq -e 'all(.[]; length == 0)' "$swarm_labels" >/dev/null
echo 'PASS three active nodes are atomically claimed, paused, verified, and restored'

new_case
printf 'node-a\tactive\nnode-b\tpause\nnode-c\tdrain\n' > "$swarm_state"
run_acquire >/dev/null
[ "$(cat "$swarm_state")" = $'node-a\tpause\nnode-b\tpause\nnode-c\tdrain' ]
run_assertion >/dev/null
run_release >/dev/null
[ "$(cat "$swarm_state")" = $'node-a\tactive\nnode-b\tpause\nnode-c\tdrain' ]
echo 'PASS pre-existing pause and drain availability is preserved exactly'

new_case
printf 'node-a\tactive\nnode-b\tactive\nnode-c\tactive\n' > "$swarm_state"
claim_failure="${case_dir}/fail-claim"
: > "$claim_failure"
status=0
output="$(MOCK_SWARM_FAIL_CLAIM_NODE=node-b \
  MOCK_SWARM_FAIL_CLAIM_ONCE="$claim_failure" run_acquire 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'Unable to persist the workflow-owned scheduler-fence claim on node node-b' <<< "$output"
[ "$(cut -f2 "$swarm_state" | LC_ALL=C sort -u)" = active ]
run_acquire >/dev/null
run_assertion >/dev/null
echo 'PASS interrupted all-node claim recovers before any availability mutation'

new_case
printf 'node-a\tactive\nnode-b\tactive\nnode-c\tactive\n' > "$swarm_state"
pause_failure="${case_dir}/fail-pause"
: > "$pause_failure"
status=0
output="$(MOCK_SWARM_FAIL_PAUSE_NODE=node-b \
  MOCK_SWARM_FAIL_PAUSE_ONCE="$pause_failure" run_acquire 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'Unable to pause workflow-owned Swarm node node-b' <<< "$output"
rm -f "${runner_temp}/beaconhs-swarm-original-node-state.tsv"
: > "$github_env"
reclaim_output="$(run_acquire)"
grep -Fq 'Reclaimed the retained workflow-owned all-node Swarm scheduler fence' \
  <<< "$reclaim_output"
run_assertion >/dev/null
echo 'PASS interrupted pause is reconstructed from durable per-node claims'

new_case
printf 'node-a\tactive\nnode-b\tactive\nnode-c\tactive\n' > "$swarm_state"
run_acquire >/dev/null
jq '."node-b"["com.beaconhs.deploy.scheduler-fence.repository"] = "other/repository"' \
  "$swarm_labels" > "${case_dir}/foreign.json"
mv "${case_dir}/foreign.json" "$swarm_labels"
status=0
output="$(run_acquire 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'incomplete or belongs to another target' <<< "$output"
echo 'PASS a foreign per-node claim cannot be inherited'

new_case
printf 'node-a\tactive\nnode-b\tactive\nnode-c\tactive\n' > "$swarm_state"
run_acquire >/dev/null
printf 'node-d\tactive\n' >> "$swarm_state"
status=0
output="$(run_assertion 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'membership does not match' <<< "$output"
echo 'PASS a node joining during the fence fails exact ownership verification'

new_case
printf 'node-a\tactive\nnode-b\tactive\nnode-c\tactive\n' > "$swarm_state"
run_acquire >/dev/null
awk -F'\t' -v OFS='\t' '$1 == "node-b" { $2 = "active" } { print }' \
  "$swarm_state" > "${case_dir}/changed-state.tsv"
mv "${case_dir}/changed-state.tsv" "$swarm_state"
status=0
output="$(run_release 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'no longer has exact paused availability before release' <<< "$output"
echo 'PASS release rejects a scheduler fence externally resumed before its release phase'

new_case
printf 'node-a\tactive\nnode-b\tactive\nnode-c\tactive\n' > "$swarm_state"
run_acquire >/dev/null
active_failure="${case_dir}/fail-active"
: > "$active_failure"
status=0
output="$(MOCK_SWARM_FAIL_ACTIVE_NODE=node-b \
  MOCK_SWARM_FAIL_ACTIVE_ONCE="$active_failure" run_release 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'Unable to restore workflow-owned Swarm node node-b' <<< "$output"
run_release >/dev/null
[ "$(cut -f2 "$swarm_state" | LC_ALL=C sort -u)" = active ]
echo 'PASS interrupted availability restoration resumes from durable releasing claims'

new_case
printf 'node-a\tactive\nnode-b\tactive\nnode-c\tactive\n' > "$swarm_state"
run_acquire >/dev/null
remove_failure="${case_dir}/fail-remove"
: > "$remove_failure"
status=0
output="$(MOCK_SWARM_FAIL_REMOVE_NODE=node-b \
  MOCK_SWARM_FAIL_REMOVE_ONCE="$remove_failure" run_release 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'Unable to remove the released scheduler-fence claim from node node-b' <<< "$output"
run_release >/dev/null
jq -e 'all(.[]; length == 0)' "$swarm_labels" >/dev/null
[ ! -e "${runner_temp}/beaconhs-swarm-original-node-state.tsv" ]
grep -Fq 'BEACONHS_SWARM_SCHEDULER_PAUSED=false' "$github_env"
echo 'PASS interrupted claim cleanup resumes only after exact restoration'
