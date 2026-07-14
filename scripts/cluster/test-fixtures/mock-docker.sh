#!/usr/bin/env bash

set -euo pipefail

: "${CUTOVER_ISOLATION_FIXTURES:?CUTOVER_ISOLATION_FIXTURES is required}"
: "${CUTOVER_ISOLATION_FIXTURE:?CUTOVER_ISOLATION_FIXTURE is required}"

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
              .replaceContainers, .replaceTasks))
          | .services = (($base.services // []) + ($fixture.services // []))
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
    jq -r '.tasks[].ID' <<<"$fixture"
    ;;
  "ps -q")
    jq -r '.containers[].Id' <<<"$fixture"
    ;;
  "inspect "*)
    shift
    jq -c --args '$ARGS.positional as $ids
      | [(.tasks + .containers)[] | select((.ID // .Id) as $id | $ids | index($id))]' \
      -- "$@" <<<"$fixture"
    ;;
  *)
    echo "Unexpected docker fixture command: $*" >&2
    exit 1
    ;;
esac
