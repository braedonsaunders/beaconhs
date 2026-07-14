#!/usr/bin/env bash

set -euo pipefail
umask 077

: "${DOKPLOY_TARGET_STACK:?DOKPLOY_TARGET_STACK is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

fail() {
  echo "::error::$*" >&2
  exit 1
}

for command in docker jq; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "${command} is required to acquire the Swarm scheduler fence"
done

label_prefix='com.beaconhs.deploy.scheduler-fence.'
version_key="${label_prefix}version"
repository_key="${label_prefix}repository"
stack_key="${label_prefix}stack"
node_key="${label_prefix}node-id"

node_state="$(docker node ls --format '{{.ID}}{{"\t"}}{{.Availability}}')" \
  || fail 'Unable to enumerate Swarm nodes while acquiring the scheduler fence'
if [ -z "$node_state" ]; then
  fail 'Docker Swarm returned no nodes while acquiring the scheduler fence'
fi
if [ "$(printf '%s\n' "$node_state" | awk 'NF { count++ } END { print count + 0 }')" -ne 1 ]; then
  fail 'The workflow-owned scheduler fence requires exactly one Swarm node'
fi
IFS=$'\t' read -r node_id availability <<< "$node_state"
[ -n "$node_id" ] || fail 'Docker Swarm returned a node without an ID'
availability="$(printf '%s' "$availability" | tr '[:upper:]' '[:lower:]')"
case "$availability" in
  active | pause) ;;
  drain)
    fail "Swarm node ${node_id} is drained and cannot be claimed as a workflow-owned pause fence"
    ;;
  *) fail "Swarm node ${node_id} has unsupported availability ${availability}" ;;
esac

read_labels() {
  docker node inspect --format '{{json .Spec.Labels}}' "$node_id" \
    || fail "Unable to inspect Swarm labels on node ${node_id}"
}

claim_is_exact() {
  jq -e --arg prefix "$label_prefix" --arg version_key "$version_key" \
    --arg repository_key "$repository_key" --arg stack_key "$stack_key" \
    --arg node_key "$node_key" --arg repository "$GITHUB_REPOSITORY" \
    --arg stack "$DOKPLOY_TARGET_STACK" --arg node "$node_id" '
      type == "object"
        and ([keys[] | select(startswith($prefix))] | sort)
          == ([$version_key, $repository_key, $stack_key, $node_key] | sort)
        and .[$version_key] == "1"
        and .[$repository_key] == $repository
        and .[$stack_key] == $stack
        and .[$node_key] == $node
    ' >/dev/null
}

labels="$(read_labels)"
claim_count="$(jq --arg prefix "$label_prefix" \
  '(. // {}) | [keys[] | select(startswith($prefix))] | length' <<< "$labels")" \
  || fail 'Swarm node labels are not valid JSON'
case "$claim_count" in
  0)
    [ "$availability" = active ] \
      || fail 'No active Swarm node is available and no workflow-owned retained fence can be reclaimed'
    docker node update \
      --label-add "${version_key}=1" \
      --label-add "${repository_key}=${GITHUB_REPOSITORY}" \
      --label-add "${stack_key}=${DOKPLOY_TARGET_STACK}" \
      --label-add "${node_key}=${node_id}" \
      "$node_id" >/dev/null \
      || fail 'Unable to persist the workflow-owned scheduler fence claim in Swarm state'
    labels="$(read_labels)"
    claim_is_exact <<< "$labels" \
      || fail 'The workflow-owned scheduler fence claim did not persist exactly'
    echo 'Created a durable workflow-owned Swarm scheduler fence claim'
    ;;
  *)
    claim_is_exact <<< "$labels" \
      || fail 'The retained Swarm scheduler fence claim is incomplete or belongs to another target'
    echo 'Reclaimed the retained workflow-owned Swarm scheduler fence'
    ;;
esac

state_file="${RUNNER_TEMP%/}/beaconhs-swarm-original-node-state.tsv"
printf '%s\tactive\n' "$node_id" > "$state_file"
chmod 0600 "$state_file"
export BEACONHS_SWARM_FENCE_NODE_ID="$node_id"
export BEACONHS_SWARM_NODE_STATE_FILE="$state_file"
export BEACONHS_SWARM_SCHEDULER_PAUSED=true
{
  printf 'BEACONHS_SWARM_FENCE_NODE_ID=%s\n' "$node_id"
  printf 'BEACONHS_SWARM_NODE_STATE_FILE=%s\n' "$state_file"
  echo 'BEACONHS_SWARM_SCHEDULER_PAUSED=true'
} >> "$GITHUB_ENV"

if [ "$availability" = active ]; then
  docker node update --availability pause "$node_id" >/dev/null \
    || fail "Unable to pause workflow-owned Swarm node ${node_id}"
fi
if [ "$(docker node inspect --format '{{.Spec.Availability}}' "$node_id")" != pause ]; then
  fail "Workflow-owned Swarm node ${node_id} did not enter scheduler-pause state"
fi

echo 'Acquired the durable workflow-owned Swarm scheduler fence'
