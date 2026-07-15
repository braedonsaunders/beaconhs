#!/usr/bin/env bash

set -euo pipefail

: "${CUTOVER_ISOLATION_FIXTURES:?CUTOVER_ISOLATION_FIXTURES is required}"
: "${CUTOVER_ISOLATION_FIXTURE:?CUTOVER_ISOLATION_FIXTURE is required}"

mock_state="${CUTOVER_ISOLATION_MOCK_STATE:-}"

fixture="$({
  jq -c --arg name "$CUTOVER_ISOLATION_FIXTURE" '
    . as $all
    | $all[$name] as $fixture
    | if $fixture == null then
        error("unknown cutover-isolation fixture: " + $name)
      elif ($fixture.extends // null) == null then
        $fixture
      else
        $all[$fixture.extends] as $base
          | $base
          * ($fixture | del(.extends, .services, .tasks, .containers, .nodes,
              .replaceServices, .replaceContainers, .replaceTasks))
          | .services = (if ($fixture | has("replaceServices")) then
              $fixture.replaceServices
            else
              (($base.services // []) + ($fixture.services // []))
            end)
          | .tasks = (if ($fixture | has("replaceTasks")) then
              $fixture.replaceTasks
            else
              (($base.tasks // []) + ($fixture.tasks // []))
            end)
          | .containers = (if ($fixture | has("replaceContainers")) then
              $fixture.replaceContainers
            else
              (($base.containers // []) + ($fixture.containers // []))
            end)
          | .nodes = (($base.nodes // []) + ($fixture.nodes // []))
      end' "$CUTOVER_ISOLATION_FIXTURES"
} 2>&1)" || {
  printf '%s\n' "$fixture" >&2
  exit 1
}

case "${1:-} ${2:-}" in
  "info --format")
    jq -r '.localNodeId' <<<"$fixture"
    ;;
  "node ls")
    jq -r '.nodes[].ID' <<<"$fixture"
    ;;
  "node inspect")
    shift 2
    jq -c --args '$ARGS.positional as $ids
      | [.nodes[] | select(.ID as $id | $ids | index($id))]' \
      -- "$@" <<<"$fixture"
    ;;
  "service ls")
    jq -r '.services[].ID' <<<"$fixture"
    ;;
  "service inspect")
    jq -c '.services' <<<"$fixture"
    ;;
  "service ps")
    shift 2
    service_ps_call=1
    if [ -n "$mock_state" ] && [ -f "$mock_state" ]; then
      service_ps_call="$(( $(cat "$mock_state") + 1 ))"
    fi
    if [ -n "$mock_state" ]; then
      printf '%s\n' "$service_ps_call" >"$mock_state"
    fi
    service_ids=()
    for argument in "$@"; do
      case "$argument" in
        -*) ;;
        *) service_ids+=("$argument") ;;
      esac
    done
    jq -r --argjson use_after "$([ "$service_ps_call" -ge 3 ] && echo true || echo false)" \
      --args '$ARGS.positional as $ids
        | (if $use_after and ((.tasksAfter // null) | type == "array") then
            .tasksAfter
          else
            .tasks
          end)[]
        | select(.ServiceID as $id | $ids | index($id))
        | .ID' -- "${service_ids[@]}" <<<"$fixture"
    ;;
  "ps -q")
    jq -r '.containers[].Id' <<<"$fixture"
    ;;
  "inspect "*)
    shift
    service_ps_call=0
    if [ -n "$mock_state" ] && [ -f "$mock_state" ]; then
      service_ps_call="$(cat "$mock_state")"
    fi
    jq -c --argjson use_after "$([ "$service_ps_call" -ge 3 ] && echo true || echo false)" \
      --args '$ARGS.positional as $ids
        | (if $use_after and ((.tasksAfter // null) | type == "array") then
            .tasksAfter
          else
            .tasks
          end) as $tasks
        | [($tasks + .containers)[]
          | select((.ID // .Id) as $id | $ids | index($id))]' \
      -- "$@" <<<"$fixture"
    ;;
  *)
    echo "Unexpected docker fixture command: $*" >&2
    exit 1
    ;;
esac
