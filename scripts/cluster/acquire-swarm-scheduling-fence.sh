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

for command in docker jq sha256sum; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "${command} is required to acquire the Swarm scheduler fence"
done

label_prefix='com.beaconhs.deploy.scheduler-fence.'
version_key="${label_prefix}version"
repository_key="${label_prefix}repository"
stack_key="${label_prefix}stack"
node_key="${label_prefix}node-id"
state_key="${label_prefix}node-set-sha256"
original_key="${label_prefix}original-availability"
phase_key="${label_prefix}phase"
state_file="${RUNNER_TEMP%/}/beaconhs-swarm-original-node-state.tsv"

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
    || fail 'Unable to enumerate Swarm nodes while acquiring the scheduler fence'
  [ -n "$raw" ] || fail 'Docker Swarm returned no nodes while acquiring the scheduler fence'
  normalized="$(normalize_state <<< "$raw")" \
    || fail 'Docker Swarm returned malformed, duplicate, or unsupported node state'
  [ -n "$normalized" ] || fail 'Docker Swarm returned no valid nodes while acquiring the scheduler fence'
  printf '%s' "$normalized"
}

state_sha256() {
  printf '%s\n' "$1" | sha256sum | awk '{print $1}'
}

state_ids() {
  cut -f1 <<< "$1"
}

read_labels() {
  docker node inspect --format '{{json .Spec.Labels}}' "$1" \
    || fail "Unable to inspect Swarm labels on node $1"
}

prefix_count() {
  jq --arg prefix "$label_prefix" \
    '(. // {}) | if type != "object" then error("labels are not an object")
      else [keys[] | select(startswith($prefix))] | length end'
}

claim_is_exact() {
  local node_id="$1" expected_sha="$2" allowed_phases="$3"
  jq -e --arg prefix "$label_prefix" --arg version_key "$version_key" \
    --arg repository_key "$repository_key" --arg stack_key "$stack_key" \
    --arg node_key "$node_key" --arg state_key "$state_key" \
    --arg original_key "$original_key" --arg phase_key "$phase_key" \
    --arg repository "$GITHUB_REPOSITORY" --arg stack "$DOKPLOY_TARGET_STACK" \
    --arg node "$node_id" --arg sha "$expected_sha" \
    --arg phases "$allowed_phases" '
      type == "object"
        and ([keys[] | select(startswith($prefix))] | sort)
          == ([$version_key, $repository_key, $stack_key, $node_key,
               $state_key, $original_key, $phase_key] | sort)
        and .[$version_key] == "2"
        and .[$repository_key] == $repository
        and .[$stack_key] == $stack
        and .[$node_key] == $node
        and .[$state_key] == $sha
        and (.[$original_key] == "active" or .[$original_key] == "pause"
          or .[$original_key] == "drain")
        and (.[$phase_key] as $phase
          | (($phases | split(",")) | index($phase)) != null)
    ' >/dev/null
}

write_state_file() {
  local contents="$1" temporary
  temporary="$(mktemp "${RUNNER_TEMP%/}/beaconhs-swarm-state.XXXXXX")" \
    || fail 'Unable to create the runner-owned Swarm state file'
  printf '%s\n' "$contents" > "$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$state_file" \
    || fail 'Unable to persist the runner-owned Swarm state file'
}

set_phase() {
  local node_id="$1" phase="$2"
  docker node update --label-add "${phase_key}=${phase}" "$node_id" >/dev/null \
    || fail "Unable to persist scheduler-fence phase ${phase} on node ${node_id}"
}

current_state="$(read_current_state)"
mapfile -t node_ids < <(state_ids "$current_state")

declare -A current_availability claim_phase original_availability
claim_count=0
claim_sha=''
for line in "${node_ids[@]}"; do
  current_availability["$line"]="$(awk -F'\t' -v id="$line" '$1 == id { print $2 }' <<< "$current_state")"
  labels="$(read_labels "$line")"
  count="$(prefix_count <<< "$labels")" \
    || fail "Swarm labels on node ${line} are not valid JSON"
  if [ "$count" -eq 0 ]; then
    continue
  fi
  claim_count=$((claim_count + 1))
  node_sha="$(jq -r --arg key "$state_key" '.[$key] // ""' <<< "$labels")"
  if ! [[ "$node_sha" =~ ^[a-f0-9]{64}$ ]]; then
    fail "The retained scheduler-fence claim on node ${line} has an invalid state fingerprint"
  fi
  if [ -n "$claim_sha" ] && [ "$node_sha" != "$claim_sha" ]; then
    fail 'Retained Swarm scheduler-fence claims disagree about their node-state fingerprint'
  fi
  claim_sha="$node_sha"
  claim_phase["$line"]="$(jq -r --arg key "$phase_key" '.[$key] // ""' <<< "$labels")"
  original_availability["$line"]="$(jq -r --arg key "$original_key" '.[$key] // ""' <<< "$labels")"
  claim_is_exact "$line" "$claim_sha" 'claiming,claimed,paused,releasing' <<< "$labels" \
    || fail "The retained Swarm scheduler-fence claim on node ${line} is incomplete or belongs to another target"
done

if [ "$claim_count" -eq 0 ]; then
  original_state="$current_state"
  claim_sha="$(state_sha256 "$original_state")"
  for node_id in "${node_ids[@]}"; do
    original="${current_availability[$node_id]}"
    docker node update \
      --label-add "${version_key}=2" \
      --label-add "${repository_key}=${GITHUB_REPOSITORY}" \
      --label-add "${stack_key}=${DOKPLOY_TARGET_STACK}" \
      --label-add "${node_key}=${node_id}" \
      --label-add "${state_key}=${claim_sha}" \
      --label-add "${original_key}=${original}" \
      --label-add "${phase_key}=claiming" \
      "$node_id" >/dev/null \
      || fail "Unable to persist the workflow-owned scheduler-fence claim on node ${node_id}"
    original_availability["$node_id"]="$original"
    claim_phase["$node_id"]='claiming'
  done
  echo 'Created durable workflow-owned claims on every Swarm node'
elif [ "$claim_count" -lt "${#node_ids[@]}" ]; then
  # A Docker node update is atomic. Partial all-node acquisition is recoverable
  # only while every persisted claim remains in the pre-mutation phase and its
  # node still has the captured original availability.
  for node_id in "${node_ids[@]}"; do
    if [ -n "${claim_phase[$node_id]:-}" ]; then
      [ "${claim_phase[$node_id]}" = claiming ] \
        || fail 'A partially persisted scheduler fence progressed beyond its recoverable claiming phase'
      [ "${current_availability[$node_id]}" = "${original_availability[$node_id]}" ] \
        || fail "Node ${node_id} changed availability during partial scheduler-fence acquisition"
    else
      original_availability["$node_id"]="${current_availability[$node_id]}"
    fi
  done
  original_state=''
  for node_id in "${node_ids[@]}"; do
    original_state+="${node_id}"$'\t'"${original_availability[$node_id]}"$'\n'
  done
  original_state="${original_state%$'\n'}"
  [ "$(state_sha256 "$original_state")" = "$claim_sha" ] \
    || fail 'Partial scheduler-fence claims do not match the current complete node inventory'
  for node_id in "${node_ids[@]}"; do
    if [ -z "${claim_phase[$node_id]:-}" ]; then
      docker node update \
        --label-add "${version_key}=2" \
        --label-add "${repository_key}=${GITHUB_REPOSITORY}" \
        --label-add "${stack_key}=${DOKPLOY_TARGET_STACK}" \
        --label-add "${node_key}=${node_id}" \
        --label-add "${state_key}=${claim_sha}" \
        --label-add "${original_key}=${original_availability[$node_id]}" \
        --label-add "${phase_key}=claiming" \
        "$node_id" >/dev/null \
        || fail "Unable to complete the workflow-owned scheduler-fence claim on node ${node_id}"
      claim_phase["$node_id"]='claiming'
    fi
  done
  echo 'Recovered a partially persisted all-node Swarm scheduler-fence claim'
else
  original_state=''
  releasing=false
  for node_id in "${node_ids[@]}"; do
    original_state+="${node_id}"$'\t'"${original_availability[$node_id]}"$'\n'
    [ "${claim_phase[$node_id]}" = releasing ] && releasing=true
  done
  original_state="${original_state%$'\n'}"
  [ "$(state_sha256 "$original_state")" = "$claim_sha" ] \
    || fail 'The retained scheduler-fence labels do not reproduce their canonical state fingerprint'
  [ "$(state_ids "$original_state")" = "$(state_ids "$current_state")" ] \
    || fail 'Swarm membership changed while the scheduler fence was retained'
  [ "$releasing" = false ] \
    || fail 'The retained Swarm scheduler fence is in release recovery and cannot be reacquired'
  echo 'Reclaimed the retained workflow-owned all-node Swarm scheduler fence'
fi

write_state_file "$original_state"

# No node availability is changed until every node has an exact durable claim.
saw_paused_phase=false
for node_id in "${node_ids[@]}"; do
  labels="$(read_labels "$node_id")"
  claim_is_exact "$node_id" "$claim_sha" 'claiming,claimed,paused' <<< "$labels" \
    || fail "The all-node scheduler-fence claim changed before node ${node_id} could be paused"
  phase="$(jq -r --arg key "$phase_key" '.[$key]' <<< "$labels")"
  [ "$phase" = paused ] && saw_paused_phase=true
  current="${current_availability[$node_id]}"
  original="${original_availability[$node_id]}"
  case "$original:$current:$phase" in
    active:active:claiming | pause:pause:claiming | drain:drain:claiming | \
      active:active:claimed | active:pause:claimed | pause:pause:claimed | \
      drain:drain:claimed | active:pause:paused | pause:pause:paused | \
      drain:drain:paused) ;;
    *) fail "Node ${node_id} availability or claim phase changed outside the scheduler-fence protocol" ;;
  esac
done

if [ "$saw_paused_phase" = true ]; then
  for node_id in "${node_ids[@]}"; do
    original="${original_availability[$node_id]}"
    expected="$original"
    [ "$original" = active ] && expected=pause
    [ "${current_availability[$node_id]}" = "$expected" ] \
      || fail 'A partially finalized scheduler fence no longer has exact paused availability'
  done
fi

for node_id in "${node_ids[@]}"; do
  phase="$(jq -r --arg key "$phase_key" '.[$key]' <<< "$(read_labels "$node_id")")"
  if [ "$phase" = claiming ]; then
    set_phase "$node_id" claimed
  fi
done

for node_id in "${node_ids[@]}"; do
  original="${original_availability[$node_id]}"
  current="$(docker node inspect --format '{{.Spec.Availability}}' "$node_id")" \
    || fail "Unable to inspect availability on workflow-owned node ${node_id}"
  current="$(printf '%s' "$current" | tr '[:upper:]' '[:lower:]')"
  if [ "$original" = active ]; then
    if [ "$current" = active ]; then
      docker node update --availability pause "$node_id" >/dev/null \
        || fail "Unable to pause workflow-owned Swarm node ${node_id}"
    elif [ "$current" != pause ]; then
      fail "Workflow-owned active node ${node_id} entered unsupported availability ${current}"
    fi
  elif [ "$current" != "$original" ]; then
    fail "Pre-existing ${original} node ${node_id} changed availability during scheduler-fence acquisition"
  fi
done

current_state="$(read_current_state)"
[ "$(state_ids "$current_state")" = "$(state_ids "$original_state")" ] \
  || fail 'Swarm membership changed while nodes were being paused'
for node_id in "${node_ids[@]}"; do
  current="$(awk -F'\t' -v id="$node_id" '$1 == id { print $2 }' <<< "$current_state")"
  original="${original_availability[$node_id]}"
  expected="$original"
  [ "$original" = active ] && expected=pause
  [ "$current" = "$expected" ] \
    || fail "Node ${node_id} did not reach its exact scheduler-fenced availability ${expected}"
done

for node_id in "${node_ids[@]}"; do
  set_phase "$node_id" paused
done

export BEACONHS_SWARM_FENCE_NODE_SET_SHA256="$claim_sha"
export BEACONHS_SWARM_NODE_STATE_FILE="$state_file"
export BEACONHS_SWARM_SCHEDULER_PAUSED=true
{
  printf 'BEACONHS_SWARM_FENCE_NODE_SET_SHA256=%s\n' "$claim_sha"
  printf 'BEACONHS_SWARM_NODE_STATE_FILE=%s\n' "$state_file"
  echo 'BEACONHS_SWARM_SCHEDULER_PAUSED=true'
} >> "$GITHUB_ENV"

echo "Acquired the durable workflow-owned scheduler fence across ${#node_ids[@]} Swarm nodes"
