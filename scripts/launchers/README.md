# BeaconHS Dev Launchers

One-click development launchers live here:

- `dev.command` - macOS Finder launcher.
- `dev.bat` - Windows launcher.
- `beaconhs-dev.desktop` - Linux desktop launcher from this folder.
- `install-linux-desktop.sh` - optional Linux installer that creates an application-menu entry with absolute paths.

The launchers run the same flow:

1. Use the repo root as the working directory.
2. Create `.env` from `.env.example` only when `.env` is missing.
3. Prepare pnpm through Corepack when available.
4. Run `pnpm install --frozen-lockfile` when dependencies are missing or stale.
5. Detect whether `DATABASE_URL` is local or remote.
6. Pull Docker Compose images, start Redis, MinIO, Mailpit, and optionally local Postgres, then wait for health checks.
7. Start `pnpm dev`.
8. On exit, stop the dev process tree and any Docker containers this launcher started.

Database mode defaults to `auto`:

- Existing `.env` with a remote `DATABASE_URL` keeps using the remote PG cluster and does not start local Postgres.
- Fresh clones that create `.env` from `.env.example` use local Postgres on `localhost:5433` and start the Compose `local-db` profile.

Useful switches:

| Variable                                 | Effect                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `BEACONHS_SKIP_INSTALL=1`                | Do not run `pnpm install`.                                                                                    |
| `BEACONHS_FORCE_INSTALL=1`               | Always run `pnpm install --frozen-lockfile`.                                                                  |
| `BEACONHS_SKIP_DOCKER=1`                 | Do not pull or start Docker Compose services.                                                                 |
| `BEACONHS_SKIP_DOCKER_PULL=1`            | Start Docker services without pulling images first.                                                           |
| `BEACONHS_KEEP_DOCKER=1`                 | Leave launcher-started Docker containers running on exit.                                                     |
| `BEACONHS_DOCKER_DOWN_ON_EXIT=1`         | Run `docker compose down --remove-orphans` on exit instead of stopping only launcher-started containers.      |
| `BEACONHS_DB_MODE=auto`                  | `auto`, `remote`, or `local`. Local mode starts the `local-db` Docker Compose profile.                        |
| `BEACONHS_DB_SETUP=auto`                 | `auto`, `1`, or `0`. Auto runs migrate + seed only for a freshly created local `.env`.                        |
| `BEACONHS_DB_GENERATE=1`                 | Run `pnpm db:generate` before DB setup. Off by default to avoid creating migration files during first launch. |
| `BEACONHS_OPEN_BROWSER=0`                | Do not open the app URL automatically.                                                                        |
| `BEACONHS_APP_URL=http://localhost:3000` | Override the URL used for browser opening and status output.                                                  |

Maintainers using the shared PG cluster should keep their real `.env` with the remote `DATABASE_URL`; the launchers will leave it alone.
