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

fail() {
  echo "::error::$*" >&2
  exit 1
}

for command in docker jq node; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "${command} is required to verify cutover isolation"
done

verified_node_id=''
verify_single_local_manager() {
  local node_ids local_node_id node_state
  local -a node_id_list

  node_ids="$(docker node ls -q)" \
    || fail 'Unable to enumerate Swarm nodes for cutover isolation'
  if [ -z "$node_ids" ]; then
    fail 'Cutover isolation requires exactly one Swarm node; none were visible'
  fi
  mapfile -t node_id_list <<<"$node_ids"
  if [ "${#node_id_list[@]}" -ne 1 ] || [ -z "${node_id_list[0]}" ]; then
    fail "Cutover isolation requires exactly one Swarm node; found ${#node_id_list[@]}"
  fi

  local_node_id="$(docker info --format '{{.Swarm.NodeID}}')" \
    || fail 'Unable to identify the local Docker Swarm node'
  if [ -z "$local_node_id" ] || [ "$local_node_id" != "${node_id_list[0]}" ]; then
    fail 'The deployment runner is not attached to the sole Swarm node'
  fi

  node_state="$(docker node inspect "$local_node_id")" \
    || fail 'Unable to inspect the sole Swarm node'
  if ! jq -e --arg id "$local_node_id" '
      type == "array" and length == 1
        and .[0].ID == $id
        and .[0].Status.State == "ready"
        and (.[0].Spec.Availability == "active"
          or .[0].Spec.Availability == "pause"
          or .[0].Spec.Availability == "drain")
        and .[0].ManagerStatus.Leader == true
        and .[0].ManagerStatus.Reachability == "reachable"' \
      <<<"$node_state" >/dev/null; then
    fail 'The sole Swarm node is not a ready, reachable manager leader'
  fi
  verified_node_id="$local_node_id"
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

verify_single_local_manager
initial_node_id="$verified_node_id"

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
  fail "Standalone Docker writer or target-database container detected during cutover: ${names}"
fi

# Re-evaluate the service specs and topology after the local container scan.
# A single-node Swarm makes the local Docker daemon authoritative; checking both
# boundaries ensures a node or service added during the proof cannot be missed.
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

verify_single_local_manager
if [ "$verified_node_id" != "$initial_node_id" ]; then
  fail 'The sole Swarm node changed during the cutover-isolation check'
fi

if [ "$writers_drained" = true ]; then
  echo 'Verified that no running Docker container can write to the drained cutover target'
else
  echo 'Verified that no external Swarm service or standalone container can write to the cutover target'
fi
