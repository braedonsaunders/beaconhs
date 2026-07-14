#!/usr/bin/env bash

set -euo pipefail

: "${BEACONHS_SWARM_FENCE_NODE_ID:?BEACONHS_SWARM_FENCE_NODE_ID is required}"
: "${BEACONHS_SWARM_NODE_STATE_FILE:?BEACONHS_SWARM_NODE_STATE_FILE is required}"
: "${DOKPLOY_TARGET_STACK:?DOKPLOY_TARGET_STACK is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

fail() {
  echo "::error::$*" >&2
  exit 1
}

node_id="$BEACONHS_SWARM_FENCE_NODE_ID"
if [ "$(docker node inspect --format '{{.Spec.Availability}}' "$node_id")" != active ]; then
  fail "Workflow-owned Swarm node ${node_id} is not active at scheduler-fence release"
fi

label_prefix='com.beaconhs.deploy.scheduler-fence.'
version_key="${label_prefix}version"
repository_key="${label_prefix}repository"
stack_key="${label_prefix}stack"
node_key="${label_prefix}node-id"
labels="$(docker node inspect --format '{{json .Spec.Labels}}' "$node_id")" \
  || fail 'Unable to inspect the workflow-owned Swarm scheduler claim before release'
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
  ' <<< "$labels" >/dev/null \
  || fail 'The workflow-owned Swarm scheduler claim changed before release'

docker node update \
  --label-rm "$version_key" \
  --label-rm "$repository_key" \
  --label-rm "$stack_key" \
  --label-rm "$node_key" \
  "$node_id" >/dev/null \
  || fail 'Unable to remove the released workflow-owned scheduler claim'
labels="$(docker node inspect --format '{{json .Spec.Labels}}' "$node_id")" \
  || fail 'Unable to verify scheduler-claim removal'
if [ "$(jq --arg prefix "$label_prefix" \
    '(. // {}) | [keys[] | select(startswith($prefix))] | length' <<< "$labels")" -ne 0 ]; then
  fail 'One or more workflow-owned scheduler claim labels remained after release'
fi

expected_state_file="${RUNNER_TEMP%/}/beaconhs-swarm-original-node-state.tsv"
[ "$BEACONHS_SWARM_NODE_STATE_FILE" = "$expected_state_file" ] \
  || fail 'Refusing to remove a non-canonical Swarm scheduler state file'
rm -f -- "$expected_state_file"
echo 'BEACONHS_SWARM_SCHEDULER_PAUSED=false' >> "$GITHUB_ENV"
echo 'Released the durable workflow-owned Swarm scheduler fence'
