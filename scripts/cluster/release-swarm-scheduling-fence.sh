#!/usr/bin/env bash

set -euo pipefail

: "${BEACONHS_SWARM_FENCE_NODE_SET_SHA256:?BEACONHS_SWARM_FENCE_NODE_SET_SHA256 is required}"
: "${BEACONHS_SWARM_NODE_STATE_FILE:?BEACONHS_SWARM_NODE_STATE_FILE is required}"
: "${DOKPLOY_TARGET_STACK:?DOKPLOY_TARGET_STACK is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

fail() {
  echo "::error::$*" >&2
  exit 1
}

for command in docker jq sha256sum; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "${command} is required to release the Swarm scheduler fence"
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
    || fail 'Unable to enumerate Swarm nodes while releasing the scheduler fence'
  [ -n "$raw" ] || fail 'Docker Swarm returned no nodes while releasing the scheduler fence'
  normalized="$(normalize_state <<< "$raw")" \
    || fail 'Docker Swarm returned malformed, duplicate, or unsupported node state'
  printf '%s' "$normalized"
}

expected_state_file="${RUNNER_TEMP%/}/beaconhs-swarm-original-node-state.tsv"
[ "$BEACONHS_SWARM_NODE_STATE_FILE" = "$expected_state_file" ] \
  || fail 'Refusing to use a non-canonical Swarm scheduler state file'
[ -f "$expected_state_file" ] && [ ! -L "$expected_state_file" ] \
  || fail 'The workflow-owned Swarm scheduler state is missing or unsafe'
raw_original_state="$(cat -- "$expected_state_file")" \
  || fail 'Unable to read the workflow-owned Swarm scheduler state'
original_state="$(normalize_state <<< "$raw_original_state")" \
  || fail 'The workflow-owned Swarm scheduler state is malformed'
[ -n "$original_state" ] && [ "$raw_original_state" = "$original_state" ] \
  || fail 'The workflow-owned Swarm scheduler state is empty or non-canonical'

if ! [[ "$BEACONHS_SWARM_FENCE_NODE_SET_SHA256" =~ ^[a-f0-9]{64}$ ]]; then
  fail 'The workflow-owned Swarm scheduler state fingerprint is invalid'
fi
actual_sha="$(printf '%s\n' "$original_state" | sha256sum | awk '{print $1}')"
[ "$actual_sha" = "$BEACONHS_SWARM_FENCE_NODE_SET_SHA256" ] \
  || fail 'The workflow-owned Swarm scheduler state fingerprint does not match its file'

current_state="$(read_current_state)"
[ "$(cut -f1 <<< "$current_state")" = "$(cut -f1 <<< "$original_state")" ] \
  || fail 'Swarm membership changed before scheduler-fence release'

label_prefix='com.beaconhs.deploy.scheduler-fence.'
version_key="${label_prefix}version"
repository_key="${label_prefix}repository"
stack_key="${label_prefix}stack"
node_key="${label_prefix}node-id"
state_key="${label_prefix}node-set-sha256"
original_key="${label_prefix}original-availability"
phase_key="${label_prefix}phase"

declare -A claim_present claim_phase current_availability
claim_count=0
paused_phase_count=0
releasing_phase_count=0
while IFS=$'\t' read -r node_id original; do
  current="$(awk -F'\t' -v id="$node_id" '$1 == id { print $2 }' <<< "$current_state")"
  current_availability["$node_id"]="$current"
  labels="$(docker node inspect --format '{{json .Spec.Labels}}' "$node_id")" \
    || fail "Unable to inspect the scheduler-fence claim on node ${node_id}"
  count="$(jq --arg prefix "$label_prefix" '
    (. // {}) | if type != "object" then error("labels are not an object")
      else [keys[] | select(startswith($prefix))] | length end' <<< "$labels")" \
    || fail "Swarm labels on node ${node_id} are not valid JSON"
  if [ "$count" -eq 0 ]; then
    claim_present["$node_id"]=false
    continue
  fi
  claim_present["$node_id"]=true
  claim_count=$((claim_count + 1))
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
        and (.[$phase_key] == "paused" or .[$phase_key] == "releasing")
    ' <<< "$labels" >/dev/null \
    || fail "The scheduler-fence claim on node ${node_id} changed before release"
  phase="$(jq -r --arg key "$phase_key" '.[$key]' <<< "$labels")"
  claim_phase["$node_id"]="$phase"
  if [ "$phase" = paused ]; then
    paused_phase_count=$((paused_phase_count + 1))
  else
    releasing_phase_count=$((releasing_phase_count + 1))
  fi
done <<< "$original_state"

node_count="$(wc -l <<< "$original_state" | tr -d ' ')"
if [ "$claim_count" -eq 0 ]; then
  [ "$current_state" = "$original_state" ] \
    || fail 'Scheduler-fence labels are absent but the original node availability is not restored'
elif [ "$claim_count" -lt "$node_count" ]; then
  # Claims are removed only after every original availability has been restored.
  # Therefore a partial removal is recoverable only at that exact state.
  [ "$current_state" = "$original_state" ] \
    || fail 'A partial scheduler-fence label release was observed before exact node restoration'
  [ "$paused_phase_count" -eq 0 ] \
    || fail 'A partial scheduler-fence label release retained an impossible paused phase'
else
  # Before phase transition all original active nodes must still be paused. Once
  # every claim is releasing, an interrupted exact restoration may contain a
  # mixture of active and paused nodes that were originally active.
  if [ "$paused_phase_count" -gt 0 ]; then
    for node_id in "${!claim_phase[@]}"; do
      original="$(awk -F'\t' -v id="$node_id" '$1 == id { print $2 }' <<< "$original_state")"
      expected="$original"
      [ "$original" = active ] && expected=pause
      [ "${current_availability[$node_id]}" = "$expected" ] \
        || fail 'Scheduler fence no longer has exact paused availability before release'
    done
  fi
  while IFS=$'\t' read -r node_id original; do
    current="${current_availability[$node_id]}"
    if [ "$original" = active ]; then
      case "$current" in
        pause | active) ;;
        *) fail "Originally active node ${node_id} entered unsupported release availability ${current}" ;;
      esac
    elif [ "$current" != "$original" ]; then
      fail "Pre-existing ${original} node ${node_id} changed availability before scheduler release"
    fi
  done <<< "$original_state"

  for node_id in "${!claim_phase[@]}"; do
    if [ "${claim_phase[$node_id]}" = paused ]; then
      docker node update --label-add "${phase_key}=releasing" "$node_id" >/dev/null \
        || fail "Unable to persist scheduler-fence release phase on node ${node_id}"
    fi
  done

  while IFS=$'\t' read -r node_id original; do
    if [ "$original" = active ]; then
      current="$(docker node inspect --format '{{.Spec.Availability}}' "$node_id")" \
        || fail "Unable to inspect workflow-owned node ${node_id} during release"
      current="$(printf '%s' "$current" | tr '[:upper:]' '[:lower:]')"
      if [ "$current" = pause ]; then
        docker node update --availability active "$node_id" >/dev/null \
          || fail "Unable to restore workflow-owned Swarm node ${node_id} to active"
      elif [ "$current" != active ]; then
        fail "Workflow-owned node ${node_id} entered unsupported release availability ${current}"
      fi
    fi
  done <<< "$original_state"
fi

restored_state="$(read_current_state)"
[ "$restored_state" = "$original_state" ] \
  || fail 'Swarm node availability did not return to the exact pre-fence state'

while IFS=$'\t' read -r node_id _original; do
  if [ "${claim_present[$node_id]:-false}" = true ]; then
    docker node update \
      --label-rm "$version_key" \
      --label-rm "$repository_key" \
      --label-rm "$stack_key" \
      --label-rm "$node_key" \
      --label-rm "$state_key" \
      --label-rm "$original_key" \
      --label-rm "$phase_key" \
      "$node_id" >/dev/null \
      || fail "Unable to remove the released scheduler-fence claim from node ${node_id}"
  fi
done <<< "$original_state"

while IFS=$'\t' read -r node_id _original; do
  labels="$(docker node inspect --format '{{json .Spec.Labels}}' "$node_id")" \
    || fail "Unable to verify scheduler-claim removal on node ${node_id}"
  remaining="$(jq --arg prefix "$label_prefix" \
    '(. // {}) | [keys[] | select(startswith($prefix))] | length' <<< "$labels")" \
    || fail "Unable to evaluate labels after releasing node ${node_id}"
  [ "$remaining" -eq 0 ] \
    || fail "One or more workflow-owned scheduler claim labels remained on node ${node_id}"
done <<< "$original_state"

rm -f -- "$expected_state_file"
{
  echo 'BEACONHS_SWARM_SCHEDULER_PAUSED=false'
  echo 'BEACONHS_SWARM_FENCE_NODE_SET_SHA256='
} >> "$GITHUB_ENV"
echo 'Released the durable workflow-owned all-node Swarm scheduler fence and restored exact node availability'
