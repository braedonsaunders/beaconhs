#!/usr/bin/env bash

set -euo pipefail

node_state="$(docker node ls --format '{{.ID}}{{"\t"}}{{.Availability}}')" \
  || {
    echo "::error::Unable to enumerate Docker Swarm nodes"
    exit 1
  }
if [ -z "$node_state" ]; then
  echo "::error::Docker Swarm returned no nodes while the scheduler fence was expected"
  exit 1
fi

while IFS=$'\t' read -r node availability; do
  availability="$(printf '%s' "$availability" | tr '[:upper:]' '[:lower:]')"
  if [ -z "$node" ]; then
    echo "::error::Docker Swarm returned a node without an ID"
    exit 1
  fi
  case "$availability" in
    pause | drain) ;;
    active)
      echo "::error::Swarm node ${node} is active while the scheduler fence is required"
      exit 1
      ;;
    *)
      echo "::error::Swarm node ${node} has unsupported availability ${availability}"
      exit 1
      ;;
  esac
done <<<"$node_state"

scripts/cluster/assert-swarm-fence-owned.sh

echo "Verified that every current Swarm node is unavailable for new task scheduling"
