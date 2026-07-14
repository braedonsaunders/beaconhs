#!/usr/bin/env bash

set -euo pipefail

: "${BEACONHS_SWARM_FENCE_NODE_ID:?BEACONHS_SWARM_FENCE_NODE_ID is required}"
: "${BEACONHS_SWARM_NODE_STATE_FILE:?BEACONHS_SWARM_NODE_STATE_FILE is required}"
: "${DOKPLOY_TARGET_STACK:?DOKPLOY_TARGET_STACK is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

fail() {
  echo "::error::$*" >&2
  exit 1
}

expected_state_file="${RUNNER_TEMP%/}/beaconhs-swarm-original-node-state.tsv"
[ "$BEACONHS_SWARM_NODE_STATE_FILE" = "$expected_state_file" ] \
  || fail 'Swarm scheduler state does not use the runner-owned canonical path'
[ -f "$expected_state_file" ] && [ ! -L "$expected_state_file" ] \
  || fail 'The workflow-owned Swarm scheduler state is missing or unsafe'
if [ "$(cat "$expected_state_file")" != "${BEACONHS_SWARM_FENCE_NODE_ID}"$'\tactive' ]; then
  fail 'The workflow-owned Swarm scheduler state does not match its claimed node'
fi

node_state="$(docker node ls --format '{{.ID}}{{"\t"}}{{.Availability}}' \
  | awk -F'\t' -v OFS='\t' 'NF { $2 = tolower($2); print }')" \
  || fail 'Unable to enumerate Swarm nodes while verifying scheduler ownership'
if [ "$node_state" != "${BEACONHS_SWARM_FENCE_NODE_ID}"$'\tpause' ]; then
  fail 'Current Swarm availability no longer matches the workflow-owned scheduler fence'
fi

label_prefix='com.beaconhs.deploy.scheduler-fence.'
version_key="${label_prefix}version"
repository_key="${label_prefix}repository"
stack_key="${label_prefix}stack"
node_key="${label_prefix}node-id"
labels="$(docker node inspect --format '{{json .Spec.Labels}}' \
  "$BEACONHS_SWARM_FENCE_NODE_ID")" \
  || fail 'Unable to inspect the workflow-owned Swarm scheduler claim'
jq -e --arg prefix "$label_prefix" --arg version_key "$version_key" \
  --arg repository_key "$repository_key" --arg stack_key "$stack_key" \
  --arg node_key "$node_key" --arg repository "$GITHUB_REPOSITORY" \
  --arg stack "$DOKPLOY_TARGET_STACK" --arg node "$BEACONHS_SWARM_FENCE_NODE_ID" '
    type == "object"
      and ([keys[] | select(startswith($prefix))] | sort)
        == ([$version_key, $repository_key, $stack_key, $node_key] | sort)
      and .[$version_key] == "1"
      and .[$repository_key] == $repository
      and .[$stack_key] == $stack
      and .[$node_key] == $node
  ' <<< "$labels" >/dev/null \
  || fail 'The durable workflow-owned Swarm scheduler claim is missing or changed'

echo 'Verified the durable workflow-owned Swarm scheduler fence claim'
