#!/usr/bin/env bash

set -euo pipefail

scripts/cluster/assert-swarm-fence-owned.sh

echo 'Verified that every workflow-owned Swarm node is unavailable for new task scheduling'
