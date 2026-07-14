#!/usr/bin/env bash

set -euo pipefail

target_stack="${1:-}"
if [[ ! "$target_stack" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "target stack name is invalid" >&2
  exit 1
fi

service_ids=()
service_list="$(docker service ls -q)" || {
  echo "unable to enumerate Docker Swarm services" >&2
  exit 1
}
while IFS= read -r service_id; do
  [ -n "$service_id" ] && service_ids+=("$service_id")
done <<< "$service_list"
if [ "${#service_ids[@]}" -eq 0 ]; then
  printf '%s\n' '[]'
  exit 0
fi

docker service inspect "${service_ids[@]}" \
  | jq -c --arg stack "$target_stack" \
      '[.[] | select((.Spec.Labels // {})["com.docker.stack.namespace"] == $stack)]'
