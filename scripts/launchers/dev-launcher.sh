#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

APP_URL="${BEACONHS_APP_URL:-http://localhost:3000}"
OPEN_BROWSER="${BEACONHS_OPEN_BROWSER:-1}"
SKIP_INSTALL="${BEACONHS_SKIP_INSTALL:-0}"
FORCE_INSTALL="${BEACONHS_FORCE_INSTALL:-0}"
SKIP_DOCKER="${BEACONHS_SKIP_DOCKER:-0}"
SKIP_DOCKER_PULL="${BEACONHS_SKIP_DOCKER_PULL:-0}"
KEEP_DOCKER="${BEACONHS_KEEP_DOCKER:-0}"
DOCKER_DOWN_ON_EXIT="${BEACONHS_DOCKER_DOWN_ON_EXIT:-0}"
DB_MODE="${BEACONHS_DB_MODE:-auto}"
DB_SETUP="${BEACONHS_DB_SETUP:-auto}"
DB_GENERATE="${BEACONHS_DB_GENERATE:-0}"

DEV_PID=""
BROWSER_WAITER_PID=""
PREEXISTING_DOCKER_IDS=""
CLEANED_UP="0"
ENV_WAS_CREATED="0"
PNPM_CMD=(pnpm)
DOCKER_COMPOSE_CMD=(docker compose)

log() {
  printf '\033[1;34m[beaconhs]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[beaconhs]\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31m[beaconhs]\033[0m %s\n' "$*" >&2
  exit 1
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

run_pnpm() {
  "${PNPM_CMD[@]}" "$@"
}

docker_compose() {
  "${DOCKER_COMPOSE_CMD[@]}" "$@"
}

collect_descendants() {
  local parent="$1"
  local child

  for child in $(pgrep -P "$parent" 2>/dev/null || true); do
    printf '%s\n' "$child"
    collect_descendants "$child"
  done
}

stop_process_tree() {
  local root_pid="$1"
  local descendants

  if ! kill -0 "$root_pid" 2>/dev/null; then
    return 0
  fi

  descendants="$(collect_descendants "$root_pid" | awk '!seen[$0]++' || true)"

  if [[ -n "$descendants" ]]; then
    kill -TERM $descendants 2>/dev/null || true
  fi
  kill -TERM "$root_pid" 2>/dev/null || true

  sleep 2

  if [[ -n "$descendants" ]]; then
    kill -KILL $descendants 2>/dev/null || true
  fi
  kill -KILL "$root_pid" 2>/dev/null || true
}

cleanup_docker() {
  local running_ids
  local stop_ids=""
  local id

  if [[ "$SKIP_DOCKER" == "1" || "$KEEP_DOCKER" == "1" ]]; then
    return 0
  fi

  if ! has_command docker || ! docker_compose version >/dev/null 2>&1; then
    return 0
  fi

  if [[ "$DOCKER_DOWN_ON_EXIT" == "1" ]]; then
    log "Stopping Docker Compose services with docker compose down..."
    docker_compose down --remove-orphans >/dev/null 2>&1 || true
    return 0
  fi

  running_ids="$(docker_compose ps -q --status running 2>/dev/null || true)"
  for id in $running_ids; do
    if ! printf '%s\n' "$PREEXISTING_DOCKER_IDS" | grep -qx "$id"; then
      stop_ids="$stop_ids $id"
    fi
  done

  if [[ -n "$stop_ids" ]]; then
    log "Stopping Docker containers started by this launcher..."
    docker stop $stop_ids >/dev/null 2>&1 || true
  fi
}

cleanup() {
  local exit_code=$?

  trap - EXIT INT TERM HUP

  if [[ "$CLEANED_UP" == "1" ]]; then
    exit "$exit_code"
  fi
  CLEANED_UP="1"

  if [[ -n "${BROWSER_WAITER_PID:-}" ]]; then
    kill "$BROWSER_WAITER_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    log "Stopping BeaconHS dev processes..."
    stop_process_tree "$DEV_PID"
  fi

  cleanup_docker
  exit "$exit_code"
}

trap cleanup EXIT INT TERM HUP

ensure_env_file() {
  if [[ -f .env ]]; then
    log "Using existing .env"
    return 0
  fi

  if [[ -f .env.example ]]; then
    cp .env.example .env
    ENV_WAS_CREATED="1"
    warn "Created .env from .env.example. Review DATABASE_URL if this machine uses the shared dev cluster."
    return 0
  fi

  warn "No .env or .env.example found. Continuing with process environment only."
}

env_value() {
  local key="$1"

  if [[ ! -f .env ]]; then
    return 0
  fi

  awk -F= -v key="$key" '
    $1 == key {
      value = substr($0, index($0, "=") + 1)
      gsub(/^["'\'']|["'\'']$/, "", value)
      print value
      exit
    }
  ' .env
}

database_url_is_local() {
  local database_url="$1"

  case "$database_url" in
    *localhost*|*127.0.0.1*|*::1*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_database_mode() {
  local database_url

  database_url="$(env_value DATABASE_URL || true)"

  case "$DB_MODE" in
    auto)
      if database_url_is_local "$database_url"; then
        DB_MODE="local"
      else
        DB_MODE="remote"
      fi
      ;;
    local|remote)
      ;;
    *)
      fail "BEACONHS_DB_MODE must be auto, local, or remote."
      ;;
  esac

  if [[ "$DB_MODE" == "local" ]]; then
    DOCKER_COMPOSE_CMD=(docker compose --profile local-db)
    log "Database mode: local Docker Postgres profile."
    if [[ -n "$database_url" ]] && ! database_url_is_local "$database_url"; then
      warn "BEACONHS_DB_MODE=local, but DATABASE_URL does not look local. Update .env or set BEACONHS_DB_MODE=remote."
    fi
  else
    DOCKER_COMPOSE_CMD=(docker compose)
    log "Database mode: remote/existing DATABASE_URL. Local Postgres will not be started."
    if database_url_is_local "$database_url"; then
      warn "DATABASE_URL looks local, but BEACONHS_DB_MODE=remote. Set BEACONHS_DB_MODE=local to start local Postgres."
    fi
  fi
}

ensure_node_and_pnpm() {
  local major
  local package_manager

  has_command node || fail "Node.js is required. Install Node 20+ and run this launcher again."
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [[ "$major" -lt 20 ]]; then
    fail "Node.js 20+ is required. Current version: $(node -v)"
  fi

  package_manager="$(node -p "require('./package.json').packageManager || 'pnpm@latest'")"

  if has_command corepack; then
    log "Preparing $package_manager with Corepack..."
    corepack enable >/dev/null 2>&1 || warn "Corepack enable failed; continuing with existing pnpm if available."
    corepack prepare "$package_manager" --activate >/dev/null 2>&1 || warn "Corepack prepare failed; continuing with existing pnpm if available."
  fi

  if has_command pnpm; then
    PNPM_CMD=(pnpm)
  elif has_command corepack; then
    PNPM_CMD=(corepack pnpm)
  else
    fail "pnpm was not found and Corepack is unavailable. Install pnpm or Node 20+."
  fi
}

dependencies_need_install() {
  local stamp="node_modules/.modules.yaml"
  local manifest

  if [[ "$FORCE_INSTALL" == "1" ]]; then
    return 0
  fi

  if [[ ! -f "$stamp" ]]; then
    return 0
  fi

  for manifest in package.json pnpm-lock.yaml pnpm-workspace.yaml apps/*/package.json packages/*/package.json; do
    if [[ -f "$manifest" && "$manifest" -nt "$stamp" ]]; then
      return 0
    fi
  done

  return 1
}

install_dependencies_if_needed() {
  if [[ "$SKIP_INSTALL" == "1" ]]; then
    log "Skipping dependency install because BEACONHS_SKIP_INSTALL=1"
    return 0
  fi

  if dependencies_need_install; then
    log "Installing dependencies with pnpm..."
    run_pnpm install --frozen-lockfile
  else
    log "Dependencies look current."
  fi
}

ensure_docker() {
  if [[ "$SKIP_DOCKER" == "1" ]]; then
    log "Skipping Docker because BEACONHS_SKIP_DOCKER=1"
    return 0
  fi

  has_command docker || fail "Docker is required for Redis, MinIO, and Mailpit."
  docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop or the Docker daemon, then run this launcher again."
  docker_compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
}

wait_for_compose_health() {
  local ids
  local id
  local name
  local status
  local attempt
  local max_attempts=60

  ids="$(docker_compose ps -q 2>/dev/null || true)"
  for id in $ids; do
    name="$(docker inspect -f '{{.Name}}' "$id" 2>/dev/null | sed 's#^/##' || printf '%s' "$id")"
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || printf 'unknown')"

    if [[ "$status" == "none" ]]; then
      continue
    fi

    log "Waiting for $name to become healthy..."
    for attempt in $(seq 1 "$max_attempts"); do
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || printf 'unknown')"
      if [[ "$status" == "healthy" ]]; then
        log "$name is healthy."
        break
      fi
      sleep 2
    done

    if [[ "$status" != "healthy" ]]; then
      warn "$name did not report healthy yet. Continuing; check Docker logs if the app cannot connect."
    fi
  done
}

start_docker() {
  if [[ "$SKIP_DOCKER" == "1" ]]; then
    return 0
  fi

  PREEXISTING_DOCKER_IDS="$(docker_compose ps -q --status running 2>/dev/null || true)"

  if [[ "$SKIP_DOCKER_PULL" != "1" ]]; then
    log "Pulling Docker images..."
    docker_compose pull --ignore-pull-failures || warn "Docker image pull had warnings; using local images where available."
  else
    log "Skipping Docker image pull because BEACONHS_SKIP_DOCKER_PULL=1"
  fi

  log "Starting Docker Compose services..."
  docker_compose up -d
  wait_for_compose_health
}

warn_about_env_ports() {
  local redis_port

  if [[ ! -f .env || "$SKIP_DOCKER" == "1" ]]; then
    return 0
  fi

  redis_port="$(docker_compose port redis 6379 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' | tail -n 1 || true)"
  if [[ -n "$redis_port" && "$redis_port" != "6379" ]] && grep -Eq '^REDIS_URL=redis://(localhost|127\.0\.0\.1):6379' .env; then
    warn ".env points REDIS_URL at port 6379, but Docker Compose publishes Redis on $redis_port."
  fi
}

run_optional_db_setup() {
  case "$DB_SETUP" in
    1)
      ;;
    0)
      log "Skipping database setup because BEACONHS_DB_SETUP=0."
      return 0
      ;;
    auto)
      if [[ "$DB_MODE" == "local" && "$ENV_WAS_CREATED" == "1" ]]; then
        log "Fresh local .env detected; database setup will run once for this launch."
      else
        log "Skipping database setup. Set BEACONHS_DB_SETUP=1 to run migrate and seed before dev."
        return 0
      fi
      ;;
    *)
      fail "BEACONHS_DB_SETUP must be auto, 1, or 0."
      ;;
  esac

  case "$DB_GENERATE" in
    1)
      log "Generating database migrations before setup..."
      run_pnpm db:generate
      ;;
    0)
      ;;
    *)
      fail "BEACONHS_DB_GENERATE must be 1 or 0."
      ;;
  esac

  log "Running database migrations and seed..."
  run_pnpm db:migrate
  run_pnpm db:seed
}

open_url() {
  local url="$1"

  case "$(uname -s)" in
    Darwin)
      open "$url" >/dev/null 2>&1 || true
      ;;
    Linux)
      if has_command xdg-open; then
        xdg-open "$url" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

wait_and_open_browser() {
  local attempt

  if ! has_command curl; then
    sleep 8
    open_url "$APP_URL"
    return 0
  fi

  for attempt in $(seq 1 90); do
    if curl -fsS -o /dev/null "$APP_URL" >/dev/null 2>&1; then
      open_url "$APP_URL"
      return 0
    fi
    sleep 2
  done

  warn "The app did not answer at $APP_URL yet. The dev server may still be compiling."
}

print_urls() {
  log "App: $APP_URL"
  log "Mailpit: http://localhost:8025"
  log "MinIO console: http://localhost:9001"
}

run_dev() {
  local status

  print_urls

  if [[ "$OPEN_BROWSER" == "1" ]]; then
    wait_and_open_browser &
    BROWSER_WAITER_PID="$!"
  fi

  log "Starting pnpm dev. Press Ctrl+C or close this window to stop everything this launcher started."
  set +e
  run_pnpm dev &
  DEV_PID="$!"
  wait "$DEV_PID"
  status=$?
  DEV_PID=""
  set -e

  return "$status"
}

main() {
  log "BeaconHS development launcher"
  ensure_env_file
  resolve_database_mode
  ensure_node_and_pnpm
  install_dependencies_if_needed
  ensure_docker
  start_docker
  warn_about_env_ports
  run_optional_db_setup
  run_dev
}

main "$@"
