#!/usr/bin/env bash

set -euo pipefail

: "${DOKPLOY_TARGET_STACK:?DOKPLOY_TARGET_STACK is required}"
: "${IMAGE_NAME:?IMAGE_NAME is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SUPERADMIN_DATABASE_URL:?SUPERADMIN_DATABASE_URL is required}"
: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
export DOKPLOY_TARGET_STACK IMAGE_NAME DATABASE_URL SUPERADMIN_DATABASE_URL
export MIGRATION_DATABASE_URL

case "${BEACONHS_CUTOVER_WRITERS_DRAINED:-false}" in
  true) writers_drained=true ;;
  false) writers_drained=false ;;
  *)
    echo '::error::BEACONHS_CUTOVER_WRITERS_DRAINED must be exactly true or false' >&2
    exit 1
    ;;
esac

case "${BEACONHS_CUTOVER_MATERIALIZED_PENDING_WRITERS:-false}" in
  true) materialized_pending_writers=true ;;
  false) materialized_pending_writers=false ;;
  *)
    echo '::error::BEACONHS_CUTOVER_MATERIALIZED_PENDING_WRITERS must be exactly true or false' >&2
    exit 1
    ;;
esac

if [ "$materialized_pending_writers" = true ] && [ "$writers_drained" != true ]; then
  echo '::error::Materialized pending writers are valid only after target writers have been drained' >&2
  exit 1
fi

fail() {
  echo "::error::$*" >&2
  exit 1
}

for command in docker jq node; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "${command} is required to verify cutover isolation"
done

verified_topology=''
verify_healthy_swarm_topology() {
  local node_ids local_node_id node_state
  local -a node_id_list

  node_ids="$(docker node ls -q)" \
    || fail 'Unable to enumerate Swarm nodes for cutover isolation'
  if [ -z "$node_ids" ]; then
    fail 'Cutover isolation requires at least one visible Swarm node'
  fi
  mapfile -t node_id_list <<<"$node_ids"

  local_node_id="$(docker info --format '{{.Swarm.NodeID}}')" \
    || fail 'Unable to identify the local Docker Swarm node'
  if [ -z "$local_node_id" ]; then
    fail 'The deployment runner is not attached to a Docker Swarm node'
  fi

  node_state="$(docker node inspect "${node_id_list[@]}")" \
    || fail 'Unable to inspect every Swarm node'
  node_ids_json="$(jq -Rn '$ARGS.positional' --args "${node_id_list[@]}")"
  jq -e --argjson ids "$node_ids_json" '
      type == "array" and length == ($ids | length)
        and ([.[].ID] | length) == ([.[].ID] | unique | length)
        and ([.[].ID] | sort) == ($ids | sort)' \
      <<<"$node_state" >/dev/null \
    || fail 'Swarm node inspection did not match the exact enumerated node set'
  jq -e 'all(.[].Status.State; . == "ready")' <<<"$node_state" >/dev/null \
    || fail 'Every Swarm node must be ready before cutover'
  jq -e 'all(.[].Spec.Availability;
      . == "active" or . == "pause" or . == "drain")' \
      <<<"$node_state" >/dev/null \
    || fail 'Every Swarm node must have a supported scheduler availability'
  jq -e '([.[] | select(.ManagerStatus.Leader == true
      and .ManagerStatus.Reachability == "reachable")] | length) == 1' \
      <<<"$node_state" >/dev/null \
    || fail 'Swarm must have exactly one reachable manager leader before cutover'
  jq -e 'all(.[] | select(.ManagerStatus != null);
      .ManagerStatus.Reachability == "reachable")' \
      <<<"$node_state" >/dev/null \
    || fail 'Every Swarm manager must be reachable before cutover'
  jq -e --arg id "$local_node_id" 'any(.[]; .ID == $id
      and .ManagerStatus != null
      and .ManagerStatus.Reachability == "reachable")' \
      <<<"$node_state" >/dev/null \
    || fail 'The deployment runner must use a reachable Swarm manager'
  verified_topology="$(jq -cS '[.[] | {
      id: .ID,
      availability: .Spec.Availability,
      state: .Status.State,
      leader: (.ManagerStatus.Leader // false),
      reachability: (.ManagerStatus.Reachability // null)
    }] | sort_by(.id)' <<<"$node_state")"
}

read_services() {
  local service_ids
  local -a service_id_list

  service_ids="$(docker service ls -q)" \
    || fail 'Unable to enumerate Swarm services for cutover isolation'
  if [ -z "$service_ids" ]; then
    printf '[]'
    return
  fi
  mapfile -t service_id_list <<<"$service_ids"
  docker service inspect "${service_id_list[@]}" \
    || fail 'Unable to inspect every Swarm service for cutover isolation'
}

find_violations() {
  local kind payload exempt_container_ids
  kind="$1"
  payload="$2"
  exempt_container_ids="${3:-[]}"
  KIND="$kind" \
    TARGET_TASK_CONTAINER_IDS="$exempt_container_ids" \
    node --input-type=module -e '
      import { readFileSync } from "node:fs";

      const kind = process.env.KIND;
      const imageName = process.env.IMAGE_NAME;
      const targetStack = process.env.DOKPLOY_TARGET_STACK;
      const exemptContainerIds = new Set(
        JSON.parse(process.env.TARGET_TASK_CONTAINER_IDS ?? "[]"),
      );

      function normalizeHost(value, encoded) {
        const decoded = (encoded ? decodeURIComponent(value) : value).trim();
        if (decoded.startsWith("/")) return decoded;
        return decoded.toLowerCase().replace(/\.+$/u, "");
      }

      function normalizeDatabase(value, encoded) {
        return (encoded ? decodeURIComponent(value) : value).replace(/^\//u, "");
      }

      function connectionIdentities(value, required = false) {
        try {
          const url = new URL(value);
          if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
            if (required) throw new Error("not a PostgreSQL URL");
            return [];
          }

          const hosts = [
            normalizeHost(url.hostname, true),
            ...url.searchParams
              .getAll("host")
              .flatMap((host) => host.split(","))
              .map((host) => normalizeHost(host, false)),
            ...url.searchParams
              .getAll("hostaddr")
              .flatMap((host) => host.split(","))
              .map((host) => normalizeHost(host, false)),
          ].filter(Boolean);
          const databases = [
            normalizeDatabase(url.pathname, true),
            ...url.searchParams
              .getAll("dbname")
              .map((database) => normalizeDatabase(database, false)),
            ...url.searchParams
              .getAll("database")
              .map((database) => normalizeDatabase(database, false)),
          ].filter(Boolean);
          const identities = [
            ...new Set(
              hosts.flatMap((host) =>
                databases.map((database) => host + "\u0000" + database),
              ),
            ),
          ];
          if (required && identities.length === 0) {
            throw new Error("missing host or database name");
          }
          return identities;
        } catch (error) {
          if (required) throw error;
          return [];
        }
      }

      const targetIdentities = new Set();
      for (const [name, value] of [
        ["DATABASE_URL", process.env.DATABASE_URL],
        ["SUPERADMIN_DATABASE_URL", process.env.SUPERADMIN_DATABASE_URL],
        ["MIGRATION_DATABASE_URL", process.env.MIGRATION_DATABASE_URL],
      ]) {
        try {
          for (const identity of connectionIdentities(value, true)) {
            targetIdentities.add(identity);
          }
        } catch {
          throw new Error(name + " does not identify a PostgreSQL host and database");
        }
      }

      function environmentUsesTargetDatabase(environment) {
        const urlMatches = environment.some((entry) => {
          if (typeof entry !== "string") return false;
          const separator = entry.indexOf("=");
          if (separator < 0) return false;
          const value = entry.slice(separator + 1);
          return connectionIdentities(value).some((identity) =>
            targetIdentities.has(identity),
          );
        });
        if (urlMatches) return true;

        const values = (name) =>
          environment.flatMap((entry) => {
            if (typeof entry !== "string" || !entry.startsWith(name + "=")) {
              return [];
            }
            return [entry.slice(name.length + 1)];
          });
        const hosts = [
          ...values("PGHOST"),
          ...values("PGHOSTADDR"),
        ]
          .flatMap((value) => value.split(","))
          .map((host) => normalizeHost(host, false))
          .filter(Boolean);
        const databases = values("PGDATABASE")
          .map((database) => normalizeDatabase(database, false))
          .filter(Boolean);
        return hosts.some((host) =>
          databases.some((database) =>
            targetIdentities.has(host + "\u0000" + database),
          ),
        );
      }

      function isBeaconWriter(image, environment) {
        const isBeaconImage =
          image.startsWith(imageName + ":") || image.startsWith(imageName + "@");
        const isWriter = environment.some(
          (entry) =>
            entry === "APP_ROLE=web" ||
            entry === "APP_ROLE=worker" ||
            entry === "APP_ROLE=scheduler",
        );
        return isBeaconImage && isWriter;
      }

      const input = JSON.parse(readFileSync(0, "utf8"));
      if (!Array.isArray(input)) throw new Error("Docker inspection was not an array");
      let violations;
      if (kind === "service") {
        const expectedTargetNames = new Set([
          targetStack + "_web",
          targetStack + "_worker",
          targetStack + "_scheduler",
          targetStack + "_storage-init",
          targetStack + "_collabora",
        ]);
        violations = input
          .filter((service) => {
            const environment = service.Spec?.TaskTemplate?.ContainerSpec?.Env ?? [];
            const image = service.Spec?.TaskTemplate?.ContainerSpec?.Image ?? "";
            const serviceStack =
              service.Spec?.Labels?.["com.docker.stack.namespace"] ?? "";
            const isExpectedTargetService =
              serviceStack === targetStack && expectedTargetNames.has(service.Spec?.Name);
            return (
              !isExpectedTargetService &&
              (isBeaconWriter(image, environment) ||
                environmentUsesTargetDatabase(environment))
            );
          })
          .map((service) => service.Spec?.Name ?? service.ID ?? "unknown-service");
      } else if (kind === "container") {
        violations = input
          .filter((container) => {
            if (container.State?.Running !== true) return false;
            if (exemptContainerIds.has(container.Id)) return false;
            const environment = container.Config?.Env ?? [];
            const image = container.Config?.Image ?? "";
            return (
              isBeaconWriter(image, environment) ||
              environmentUsesTargetDatabase(environment)
            );
          })
          .map((container) => container.Name ?? container.Id ?? "unknown-container");
      } else {
        throw new Error("Unsupported cutover-isolation inspection kind");
      }
      process.stdout.write(JSON.stringify(violations));
    ' <<<"$payload"
}

report_service_violations() {
  local services violations names
  services="$1"
  violations="$(find_violations service "$services")" \
    || fail 'Unable to evaluate Swarm services for cutover isolation'
  if [ "$(jq 'length' <<<"$violations")" -ne 0 ]; then
    names="$(jq -r 'join(", ")' <<<"$violations")"
    fail "External Swarm writer or target-database service detected during cutover: ${names}"
  fi
}

select_writer_services() {
  jq -c --arg stack "$DOKPLOY_TARGET_STACK" '
    [.[]
      | select(((.Spec.Labels // {})["com.docker.stack.namespace"] // "") == $stack)
      | .Spec.Name as $name
      | select([$stack+"_web", $stack+"_worker", $stack+"_scheduler"]
          | index($name) != null)
      | {
          id: .ID,
          name: $name,
          role: (if $name == ($stack+"_web") then "web"
            elif $name == ($stack+"_worker") then "worker"
            else "scheduler"
            end)
        }]'
}

materialized_writer_services_are_canonical() {
  jq -e --arg stack "$DOKPLOY_TARGET_STACK" '
    length == 3
      and ([.[].id] | all(.[]; type == "string" and length > 0))
      and ([.[].id] | length == (unique | length))
      and ([.[].name] | sort)
        == ([$stack+"_scheduler", $stack+"_web", $stack+"_worker"] | sort)
      and ([.[].role] | sort) == ["scheduler", "web", "worker"]' \
    >/dev/null
}

materialized_writer_tasks_are_safe() {
  local writer_services_json
  writer_services_json="$1"
  jq -e --argjson writers "$writer_services_json" '
    def terminal:
      (.Status.State // "") as $state
      | ($state == "complete" or $state == "shutdown"
        or $state == "failed" or $state == "rejected"
        or $state == "remove" or $state == "orphaned");
    . as $tasks
    | type == "array"
      and ([.[].ID] | all(.[]; type == "string" and length > 0))
      and ([.[].ID] | length == (unique | length))
      and all($tasks[];
        .ServiceID as $service_id
        | any($writers[]; .id == $service_id))
      and all($writers[];
        . as $writer
        | [$tasks[]
            | select(.ServiceID == $writer.id
              and (.DesiredState // "") == "running")] as $current
        | ($current | length) == 1
          and ($current[0].Status.State // "") == "pending"
          and ($current[0].NodeID // "") == ""
          and ($current[0].Status.ContainerStatus.ContainerID // "") == ""
          and ([$tasks[]
            | select(.ServiceID == $writer.id
              and .ID != $current[0].ID)]
            | all(.[]; terminal)))' \
    >/dev/null
}

verify_healthy_swarm_topology
initial_topology="$verified_topology"
if [ "$materialized_pending_writers" = true ] \
  && ! jq -e 'all(.[];
      .availability == "pause" or .availability == "drain")' \
    <<<"$initial_topology" >/dev/null; then
  fail 'Materialized pending writers require every Swarm node to remain unavailable for scheduling'
fi

services="$(read_services)"
report_service_violations "$services"

target_service_ids="$(jq -r --arg stack "$DOKPLOY_TARGET_STACK" '
  .[]
  | select(((.Spec.Labels // {})["com.docker.stack.namespace"] // "") == $stack)
  | .Spec.Name as $name
  | select([$stack+"_web", $stack+"_worker", $stack+"_scheduler",
      $stack+"_storage-init", $stack+"_collabora"] | index($name) != null)
  | .ID' <<<"$services")"
if [ -z "$target_service_ids" ]; then
  target_tasks='[]'
else
  mapfile -t target_service_id_list <<<"$target_service_ids"
  target_task_ids="$(docker service ps -q --no-trunc "${target_service_id_list[@]}")" \
    || fail 'Unable to enumerate the target stack tasks'
  if [ -z "$target_task_ids" ]; then
    target_tasks='[]'
  else
    mapfile -t target_task_id_list <<<"$target_task_ids"
    target_tasks="$(docker inspect "${target_task_id_list[@]}")" \
      || fail 'Unable to inspect every target stack task'
    target_service_ids_json="$(jq -Rn '$ARGS.positional' \
      --args "${target_service_id_list[@]}")"
    target_task_ids_json="$(jq -Rn '$ARGS.positional' \
      --args "${target_task_id_list[@]}")"
    if ! jq -e \
        --argjson service_ids "$target_service_ids_json" \
        --argjson task_ids "$target_task_ids_json" '
          type == "array"
            and ([.[].ID] | sort) == ($task_ids | sort)
            and all(.[];
              .ServiceID as $service_id
              | ($service_ids | index($service_id)) != null)' \
        <<<"$target_tasks" >/dev/null; then
      fail 'Target stack task inspection did not match the enumerated services and tasks'
    fi
  fi
fi
if [ "$writers_drained" = true ]; then
  # Before downtime, current target-stack tasks are expected and are exempted
  # from the outside-writer scan. Once the workflow has drained writers, no
  # running target writer is safe: inspect every container so a task that was
  # restarted during the cutover cannot hide behind its Swarm service identity.
  target_task_container_ids='[]'

  writer_services="$(select_writer_services <<<"$services")" \
    || fail 'Unable to identify target writer services'

  if [ "$materialized_pending_writers" = true ] \
    && ! materialized_writer_services_are_canonical <<<"$writer_services"; then
    fail 'Materialized pending-writer phase requires exactly the canonical web, worker, and scheduler services'
  fi

  writer_service_ids="$(jq -r '.[].id' <<<"$writer_services")"
  if [ -n "$writer_service_ids" ]; then
    mapfile -t writer_service_id_list <<<"$writer_service_ids"
    writer_task_ids="$(docker service ps -q --no-trunc "${writer_service_id_list[@]}")" \
      || fail 'Unable to enumerate drained writer tasks across the Swarm'
    if [ -n "$writer_task_ids" ]; then
      mapfile -t writer_task_id_list <<<"$writer_task_ids"
      writer_tasks="$(docker inspect "${writer_task_id_list[@]}")" \
        || fail 'Unable to inspect drained writer tasks across the Swarm'
      if [ "$materialized_pending_writers" = true ]; then
        if ! materialized_writer_tasks_are_safe "$writer_services" \
          <<<"$writer_tasks"; then
          fail 'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history'
        fi
        materialized_writer_task_ids="$(jq -cS '[.[].ID] | sort' \
          <<<"$writer_tasks")"
      elif ! jq -e '
          type == "array"
            and all(.[];
              (.Status.State // "") as $state
              | ($state == "complete" or $state == "shutdown"
                or $state == "failed" or $state == "rejected"
                or $state == "remove" or $state == "orphaned"))' \
          <<<"$writer_tasks" >/dev/null; then
        fail 'A target writer task remains nonterminal somewhere in the Swarm after writer drain'
      fi
    elif [ "$materialized_pending_writers" = true ]; then
      fail 'Materialized target writers must be exactly one unassigned, containerless Pending task per role with only terminal history'
    fi
  elif [ "$materialized_pending_writers" = true ]; then
    fail 'Materialized pending-writer phase requires exactly the canonical web, worker, and scheduler services'
  fi
else
  target_task_container_ids="$(jq -c '
    [.[] | .Status.ContainerStatus.ContainerID?
      | select(type == "string" and length > 0)] | unique' <<<"$target_tasks")"
fi

container_ids="$(docker ps -q)" \
  || fail 'Unable to enumerate running Docker containers for cutover isolation'
if [ -z "$container_ids" ]; then
  containers='[]'
else
  mapfile -t container_id_list <<<"$container_ids"
  containers="$(docker inspect "${container_id_list[@]}")" \
    || fail 'Unable to inspect every running Docker container for cutover isolation'
fi

container_violations="$(
  find_violations container "$containers" "$target_task_container_ids"
)" || fail 'Unable to evaluate running containers for cutover isolation'
if [ "$(jq 'length' <<<"$container_violations")" -ne 0 ]; then
  names="$(jq -r 'join(", ")' <<<"$container_violations")"
  if [ "$writers_drained" = true ]; then
    fail "Running Docker writer or target-database container detected after writer drain: ${names}"
  fi
  fail "Deployment-manager standalone writer or target-database container detected during cutover: ${names}"
fi

# Swarm service and task inspection is cluster-wide. Standalone containers are
# node-local in the Docker API, so the direct container check above covers the
# deployment manager while the scheduler fence and global service/task proofs
# cover all managed workloads. Re-evaluate every observable boundary so a node
# or service added during the proof cannot be missed.
services_after="$(read_services)"
report_service_violations "$services_after"
if [ "$(jq -cS '[.[].ID] | sort' <<<"$services")" \
    != "$(jq -cS '[.[].ID] | sort' <<<"$services_after")" ]; then
  fail 'The Swarm service set changed during the cutover-isolation check'
fi

container_ids_after="$(docker ps -q)" \
  || fail 'Unable to re-enumerate running Docker containers for cutover isolation'
if [ "$(printf '%s\n' "$container_ids" | sed '/^$/d' | LC_ALL=C sort)" \
    != "$(printf '%s\n' "$container_ids_after" | sed '/^$/d' | LC_ALL=C sort)" ]; then
  fail 'The running Docker container set changed during the cutover-isolation check'
fi

verify_healthy_swarm_topology
if [ "$verified_topology" != "$initial_topology" ]; then
  fail 'The Swarm topology changed during the cutover-isolation check'
fi

if [ "$materialized_pending_writers" = true ]; then
  writer_services_after="$(select_writer_services <<<"$services_after")" \
    || fail 'Unable to re-identify target writer services'
  if ! materialized_writer_services_are_canonical <<<"$writer_services_after" \
    || [ "$(jq -cS 'sort_by(.id)' <<<"$writer_services_after")" \
      != "$(jq -cS 'sort_by(.id)' <<<"$writer_services")" ]; then
    fail 'The canonical target writer service set changed during the cutover-isolation check'
  fi

  writer_service_ids_after="$(jq -r '.[].id' <<<"$writer_services_after")"
  mapfile -t writer_service_id_list_after <<<"$writer_service_ids_after"
  writer_task_ids_after="$(docker service ps -q --no-trunc \
    "${writer_service_id_list_after[@]}")" \
    || fail 'Unable to re-enumerate materialized writer tasks across the Swarm'
  if [ -z "$writer_task_ids_after" ]; then
    fail 'Materialized target writer tasks disappeared during the cutover-isolation check'
  fi
  mapfile -t writer_task_id_list_after <<<"$writer_task_ids_after"
  writer_tasks_after="$(docker inspect "${writer_task_id_list_after[@]}")" \
    || fail 'Unable to re-inspect materialized writer tasks across the Swarm'
  if [ "$(jq -cS '[.[].ID] | sort' <<<"$writer_tasks_after")" \
    != "$materialized_writer_task_ids" ]; then
    fail 'The materialized target writer task set changed during the cutover-isolation check'
  fi
  if ! materialized_writer_tasks_are_safe "$writer_services_after" \
    <<<"$writer_tasks_after"; then
    fail 'Materialized target writer task state changed during the cutover-isolation check'
  fi
fi

if [ "$writers_drained" = true ]; then
  echo 'Verified that no running Docker container can write to the drained cutover target'
else
  echo 'Verified that no external Swarm service or deployment-manager standalone container can write to the cutover target'
fi
