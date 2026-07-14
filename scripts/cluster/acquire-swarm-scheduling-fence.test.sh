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
    if [[ "$*" == *'{{json .Spec.Labels}}'* ]]; then
      cat "$MOCK_SWARM_LABELS"
    else
      node="${@: -1}"
      awk -F'\t' -v node="$node" '$1 == node { print $2; found = 1 }
        END { if (!found) exit 1 }' "$MOCK_SWARM_STATE"
    fi
    ;;
  "node update")
    shift 2
    labels="$(cat "$MOCK_SWARM_LABELS")"
    availability=''
    node=''
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --label-add)
          assignment="${2:?label assignment is required}"
          key="${assignment%%=*}"
          value="${assignment#*=}"
          labels="$(jq -c --arg key "$key" --arg value "$value" \
            '.[$key] = $value' <<< "$labels")"
          shift 2
          ;;
        --label-rm)
          key="${2:?label key is required}"
          labels="$(jq -c --arg key "$key" 'del(.[$key])' <<< "$labels")"
          shift 2
          ;;
        --availability)
          availability="${2:?availability is required}"
          shift 2
          ;;
        *)
          node="$1"
          shift
          ;;
      esac
    done
    [ -n "$node" ] || exit 98
    printf '%s\n' "$labels" > "$MOCK_SWARM_LABELS"
    if [ -n "$availability" ]; then
      if [ "$availability" = pause ] \
        && [ -n "${MOCK_SWARM_FAIL_PAUSE_ONCE:-}" ] \
        && [ -f "$MOCK_SWARM_FAIL_PAUSE_ONCE" ]; then
        rm -f "$MOCK_SWARM_FAIL_PAUSE_ONCE"
        exit 75
      fi
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
    RUNNER_TEMP="$runner_temp" \
    GITHUB_ENV="$github_env" \
    GITHUB_REPOSITORY='braedonsaunders/beaconhs-platform' \
    DOKPLOY_TARGET_STACK='beaconhs' \
    "$subject"
}

fence_env() {
  export BEACONHS_SWARM_FENCE_NODE_ID='node-primary'
  export BEACONHS_SWARM_NODE_STATE_FILE="${runner_temp}/beaconhs-swarm-original-node-state.tsv"
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
    RUNNER_TEMP="$runner_temp" \
    GITHUB_ENV="$github_env" \
    GITHUB_REPOSITORY='braedonsaunders/beaconhs-platform' \
    DOKPLOY_TARGET_STACK='beaconhs' \
    "$release"
}

new_case
printf 'node-primary\tactive\n' > "$swarm_state"
printf 'null\n' > "$swarm_labels"
run_acquire >/dev/null
[ "$(cut -f2 "$swarm_state")" = pause ]
MOCK_NODE_LS_TITLECASE=true run_assertion >/dev/null
grep -Fq 'BEACONHS_SWARM_SCHEDULER_PAUSED=true' "$github_env"
jq -e '.["com.beaconhs.deploy.scheduler-fence.repository"]
  == "braedonsaunders/beaconhs-platform"' "$swarm_labels" >/dev/null
echo 'PASS fresh active node is durably labeled and paused'

# Simulate the next Actions job: RUNNER_TEMP was cleared, but Swarm labels and
# the paused node survived. The acquire step must reconstruct local state.
rm -f "${runner_temp}/beaconhs-swarm-original-node-state.tsv"
: > "$github_env"
reclaim_output="$(run_acquire)"
grep -Fq 'Reclaimed the retained workflow-owned Swarm scheduler fence' \
  <<< "$reclaim_output"
run_assertion >/dev/null
echo 'PASS a later workflow run reclaims the durable Swarm-state fence'

new_case
printf 'node-primary\tpause\n' > "$swarm_state"
status=0
output="$(run_acquire 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'no workflow-owned retained fence can be reclaimed' <<< "${output,,}"
echo 'PASS an operator-prepaused node without labels fails closed'

new_case
printf 'node-primary\tactive\n' > "$swarm_state"
fail_once="${case_dir}/fail-pause"
: > "$fail_once"
status=0
output="$(
  MOCK_SWARM_FAIL_PAUSE_ONCE="$fail_once" run_acquire 2>&1
)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'Unable to pause workflow-owned Swarm node' <<< "$output"
jq -e 'has("com.beaconhs.deploy.scheduler-fence.version")' \
  "$swarm_labels" >/dev/null
rm -f "${runner_temp}/beaconhs-swarm-original-node-state.tsv"
run_acquire >/dev/null
run_assertion >/dev/null
echo 'PASS an interrupted pause retains a durable claim and recovers on rerun'

printf 'node-primary\tdrain\n' > "$swarm_state"
status=0
output="$(run_acquire 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'is drained and cannot be claimed' <<< "$output"
echo 'PASS an operator availability change cannot inherit workflow ownership'

new_case
printf 'node-primary\tactive\n' > "$swarm_state"
run_acquire >/dev/null
jq '.["com.beaconhs.deploy.scheduler-fence.repository"] = "other/repository"' \
  "$swarm_labels" > "${case_dir}/wrong-labels.json"
mv "${case_dir}/wrong-labels.json" "$swarm_labels"
status=0
output="$(run_acquire 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'belongs to another target' <<< "$output"
echo 'PASS a claim from another repository cannot be reclaimed'

new_case
printf 'node-primary\tactive\n' > "$swarm_state"
jq -n '{"com.beaconhs.deploy.scheduler-fence.version":"1"}' > "$swarm_labels"
status=0
output="$(run_acquire 2>&1)" || status=$?
[ "$status" -ne 0 ]
grep -Fq 'incomplete or belongs to another target' <<< "$output"
echo 'PASS a partial Swarm label claim fails closed'

new_case
printf 'node-primary\tactive\n' > "$swarm_state"
run_acquire >/dev/null
printf 'node-primary\tactive\n' > "$swarm_state"
run_release >/dev/null
[ "$(jq 'length' "$swarm_labels")" -eq 0 ]
[ ! -e "${runner_temp}/beaconhs-swarm-original-node-state.tsv" ]
grep -Fq 'BEACONHS_SWARM_SCHEDULER_PAUSED=false' "$github_env"
run_acquire >/dev/null
echo 'PASS successful release removes only the workflow claim and permits a fresh run'
