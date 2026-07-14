#!/usr/bin/env bash

set -euo pipefail

: "${BEACONHS_SWARM_FENCE_NODE_SET_SHA256:?BEACONHS_SWARM_FENCE_NODE_SET_SHA256 is required}"
: "${BEACONHS_SWARM_NODE_STATE_FILE:?BEACONHS_SWARM_NODE_STATE_FILE is required}"
: "${DOKPLOY_TARGET_STACK:?DOKPLOY_TARGET_STACK is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

fail() {
  echo "::error::$*" >&2
  exit 1
}

for command in docker jq sha256sum; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "${command} is required to verify the Swarm scheduler fence"
done

normalize_state() {
  awk -F'\t' -v OFS='\t' '
    NF {
      if (NF != 2 || $1 == "") exit 2
      $2 = tolower($2)
      if ($2 != "active" && $2 != "pause" && $2 != "drain") exit 3
      if (seen[$1]++) exit 4
      print $1, $2
    }
  ' | LC_ALL=C sort -t $'\t' -k1,1
}

read_current_state() {
  local raw normalized
  raw="$(docker node ls --format '{{.ID}}{{"\t"}}{{.Availability}}')" \
    || fail 'Unable to enumerate Swarm nodes while verifying scheduler ownership'
  [ -n "$raw" ] || fail 'Docker Swarm returned no nodes while verifying scheduler ownership'
  normalized="$(normalize_state <<< "$raw")" \
    || fail 'Docker Swarm returned malformed, duplicate, or unsupported node state'
  printf '%s' "$normalized"
}

expected_state_file="${RUNNER_TEMP%/}/beaconhs-swarm-original-node-state.tsv"
[ "$BEACONHS_SWARM_NODE_STATE_FILE" = "$expected_state_file" ] \
  || fail 'Swarm scheduler state does not use the runner-owned canonical path'
[ -f "$expected_state_file" ] && [ ! -L "$expected_state_file" ] \
  || fail 'The workflow-owned Swarm scheduler state is missing or unsafe'

raw_original_state="$(cat -- "$expected_state_file")" \
  || fail 'Unable to read the workflow-owned Swarm scheduler state'
[ -n "$raw_original_state" ] \
  || fail 'The workflow-owned Swarm scheduler state is empty'
original_state="$(normalize_state <<< "$raw_original_state")" \
  || fail 'The workflow-owned Swarm scheduler state is malformed'
[ "$raw_original_state" = "$original_state" ] \
  || fail 'The workflow-owned Swarm scheduler state is not canonical'

if ! [[ "$BEACONHS_SWARM_FENCE_NODE_SET_SHA256" =~ ^[a-f0-9]{64}$ ]]; then
  fail 'The workflow-owned Swarm scheduler state fingerprint is invalid'
fi
actual_sha="$(printf '%s\n' "$original_state" | sha256sum | awk '{print $1}')"
[ "$actual_sha" = "$BEACONHS_SWARM_FENCE_NODE_SET_SHA256" ] \
  || fail 'The workflow-owned Swarm scheduler state fingerprint does not match its file'

current_state="$(read_current_state)"
[ "$(cut -f1 <<< "$current_state")" = "$(cut -f1 <<< "$original_state")" ] \
  || fail 'Current Swarm membership does not match the workflow-owned scheduler fence'

label_prefix='com.beaconhs.deploy.scheduler-fence.'
version_key="${label_prefix}version"
repository_key="${label_prefix}repository"
stack_key="${label_prefix}stack"
node_key="${label_prefix}node-id"
state_key="${label_prefix}node-set-sha256"
original_key="${label_prefix}original-availability"
phase_key="${label_prefix}phase"

while IFS=$'\t' read -r node_id original; do
  current="$(awk -F'\t' -v id="$node_id" '$1 == id { print $2 }' <<< "$current_state")"
  expected="$original"
  [ "$original" = active ] && expected=pause
  [ "$current" = "$expected" ] \
    || fail "Node ${node_id} has availability ${current:-missing}; scheduler-fence ownership requires ${expected}"

  labels="$(docker node inspect --format '{{json .Spec.Labels}}' "$node_id")" \
    || fail "Unable to inspect the workflow-owned scheduler claim on node ${node_id}"
  jq -e --arg prefix "$label_prefix" --arg version_key "$version_key" \
    --arg repository_key "$repository_key" --arg stack_key "$stack_key" \
    --arg node_key "$node_key" --arg state_key "$state_key" \
    --arg original_key "$original_key" --arg phase_key "$phase_key" \
    --arg repository "$GITHUB_REPOSITORY" --arg stack "$DOKPLOY_TARGET_STACK" \
    --arg node "$node_id" --arg sha "$actual_sha" --arg original "$original" '
      type == "object"
        and ([keys[] | select(startswith($prefix))] | sort)
          == ([$version_key, $repository_key, $stack_key, $node_key,
               $state_key, $original_key, $phase_key] | sort)
        and .[$version_key] == "2"
        and .[$repository_key] == $repository
        and .[$stack_key] == $stack
        and .[$node_key] == $node
        and .[$state_key] == $sha
        and .[$original_key] == $original
        and .[$phase_key] == "paused"
    ' <<< "$labels" >/dev/null \
    || fail "The durable workflow-owned scheduler claim on node ${node_id} is missing or changed"
done <<< "$original_state"

# Close the inspection race: membership and availability must still equal the
# exact state proved above after every durable claim has been inspected.
current_state_after="$(read_current_state)"
[ "$current_state_after" = "$current_state" ] \
  || fail 'Swarm membership or availability changed during scheduler-fence verification'

echo 'Verified the durable workflow-owned all-node Swarm scheduler fence claim'
