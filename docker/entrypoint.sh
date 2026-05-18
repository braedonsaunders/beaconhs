#!/usr/bin/env sh
set -e

case "${APP_ROLE:-web}" in
  web)
    exec node apps/web/server.js
    ;;
  worker)
    exec node apps/worker/dist/index.js
    ;;
  scheduler)
    exec node apps/worker/dist/scheduler.js
    ;;
  *)
    echo "Unknown APP_ROLE: ${APP_ROLE}" >&2
    exit 1
    ;;
esac
