# Production operations runbook

This runbook is the minimum operating contract for a BeaconHS environment. It
is intentionally separate from the historical implementation plan.

## Launch gates

Do not accept production traffic until all of these are true:

- `main` is protected and every required CI/security check is green.
- PostgreSQL uses TLS, continuous WAL archiving/PITR, encrypted off-host
  backups, and a restore drill from the same backup system.
- Redis has AOF persistence, protected storage, and restart/restore monitoring.
- The object bucket is private, versioned, encrypted, and covered by inventory
  and lifecycle policies.
- Runtime, migration, backup, and cross-tenant database credentials are
  separate. No long-running container receives migration or backup credentials.
- BeaconHS web, worker, scheduler, and storage-init containers run as the
  unprivileged image user (UID/GID 1000), not root.
- Production secrets are unique, stored in the deploy secret manager, and have
  an owner and rotation procedure.
- Readiness checks prove the exact deployed Git SHA for web and worker services.
- Error monitoring is configured for web, client, worker, and scheduler runtimes;
  its alert route and a synthetic error have been verified.
- An operator has approved recovery targets. A practical baseline is an RPO of
  15 minutes and an RTO of 4 hours; tighten these if the business requires it.

## Database roles

Provision once as a PostgreSQL superuser:

```bash
psql "$CLUSTER_ADMIN_DATABASE_URL" \
  -v app_password="$APP_PASSWORD" \
  -v super_password="$SUPERADMIN_PASSWORD" \
  -v migrator_password="$MIGRATOR_PASSWORD" \
  -v backup_password="$BACKUP_PASSWORD" \
  -f scripts/cluster/provision.sql
```

The resulting roles are deliberately non-interchangeable:

| Role                | Purpose                                 | Ownership        | RLS bypass | Normal writes                  |
| ------------------- | --------------------------------------- | ---------------- | ---------- | ------------------------------ |
| `beaconhs_owner`    | Own database/schema/application objects | Yes, NOLOGIN     | No         | Migration only via `SET ROLE`  |
| `beaconhs_migrator` | Direct, unpooled migration login        | Can assume owner | No         | DDL while owner role is active |
| `beaconhs_app`      | Tenant-scoped web/worker traffic        | No               | No         | DML only                       |
| `beaconhs_super`    | Intentional cross-tenant maintenance    | No               | Yes        | DML only                       |
| `beaconhs_backup`   | Logical backups                         | No               | Yes        | None; defaults read-only       |

Use direct PostgreSQL port 5432 for `MIGRATION_DATABASE_URL`. Runtime URLs may
use a transaction-mode pooler. Never place `MIGRATION_DATABASE_URL` or
backup-role credentials in web, worker, or scheduler service environments.

## Dev deployment secret contract

The reusable deployment validates required secret names before it builds an
image or touches the self-hosted runner. It checks presence, URL schemes,
minimum signing-secret lengths, separation of database roles and signing keys,
and rejects CR/LF in every value that crosses the line-oriented Dokploy
environment contract. For a Cloudflare R2 endpoint, it requires
`R2_PRIVATE_BUCKET_CONFIRMED=true`. That confirmation may only be set after an
operator has disabled and independently verified every R2 public development
URL and custom domain. Other S3-compatible endpoints do not need the manual
confirmation: the one-shot storage initializer removes the bucket policy and
proves that an unsigned canary read is denied before deployment is healthy.

Required GitHub Actions repository secrets:

```text
DEV_APP_URL
DEV_ATTACHMENT_CAPABILITY_SECRET
DEV_BETTER_AUTH_SECRET
DEV_DATABASE_URL
DEV_MIGRATION_DATABASE_URL
DEV_REDIS_URL
DEV_SUPERADMIN_DATABASE_URL
DOKPLOY_COMPOSE_ID
DOKPLOY_RESOLVE_IP
DOKPLOY_TOKEN
DOKPLOY_URL
R2_ACCESS_KEY_ID
R2_BUCKET
R2_ENDPOINT
R2_SECRET_ACCESS_KEY
VAPID_PRIVATE_KEY
VAPID_PUBLIC_KEY
VAPID_SUBJECT
```

`R2_PRIVATE_BUCKET_CONFIRMED` is additionally required when `R2_ENDPOINT` is a
Cloudflare `r2.cloudflarestorage.com` endpoint. It is unused for the private dev
MinIO-compatible endpoint.

Production email providers are configured in **Platform email** and their
credentials are encrypted in PostgreSQL with a key derived from the runtime
`BETTER_AUTH_SECRET` (supplied by the `DEV_BETTER_AUTH_SECRET` GitHub secret in
the dev workflow). The private deployment runner verifies that the platform
provider is enabled, complete, and decryptable before it stops any writers. Do
not add provider API keys to the container environment. Before cutover, verify
the sender identity or domain with the selected provider, allow the deployment
egress addresses when the provider uses an IP allowlist, and send a test from
**Platform email** to an independently monitored mailbox. Custom SMTP must use
an externally resolvable public DNS hostname and a certificate that validates
for that hostname. BeaconHS blocks private, local, reserved, and IP-literal
SMTP targets and requires verified implicit TLS or STARTTLS.

The deploy job uses its job-scoped `GITHUB_TOKEN` with `packages: read` only to
pre-pull the exact new digest into a temporary Docker configuration before
database downtime. It never stores that short-lived token in Dokploy. Each
compose update round-trips the exact live `registryId` returned by Dokploy and
verifies that it did not change. Maintain and rotate the working GHCR login in
Dokploy itself; do not replace it with an Actions token, which expires after the
job.

`SENTRY_DSN` is warning-only for the dev deployment so a monitoring-provider
outage does not block schema recovery, but it remains mandatory before
production traffic is accepted. `GITHUB_TOKEN` remains scoped per job: package
write for image publication, package read plus repository read for the
deployment's exact-digest pull and stale-main guard, and no permissions for the
preflight job. Validation and refresh-token rotation receive repository read
only so they can run the audited, checked-in safeguards.

All Dokploy API calls load `DOKPLOY_TOKEN` from a mode-`0600` temporary header
file. The helper removes that file on success, failure, or interruption and
never places the API key in curl's process arguments.

`DEV_DIRECT_DATABASE_URL`, `DOKPLOY_REGISTRY_ID`, and `R2_PUBLIC_URL` are
retired names and are not consumed by the workflow or containers. Remove stale
repository entries rather than reintroducing any of them.

## PostgreSQL backup and recovery

### Required provider/cluster controls

Logical dumps are a second recovery layer, not PITR. Configure the PostgreSQL
host or backup sidecar to provide:

1. TLS with certificate verification for every non-local client.
2. Encrypted base backups at least daily.
3. Continuous WAL archiving with retention sufficient for the approved RPO.
4. An encrypted, off-host, immutable destination with retention alerts.
5. Backup success, age, size-drift, and restore-drill monitoring.

### Nightly logical backup

Install PostgreSQL 16 client tools and `age`, then set a public `age` recipient:

```bash
export PGHOST=db.internal
export PGPORT=5432
export PGDATABASE=beaconhs
export PGUSER=beaconhs_backup
export PGPASSFILE=/secure/path/beaconhs-backup.pgpass
export PGSSLMODE=verify-full
export PGSSLROOTCERT=/secure/path/postgres-ca.pem
export BACKUP_AGE_RECIPIENT='age1...'
scripts/cluster/backup.sh /secure/off-host-staging/beaconhs
```

The `.pgpass` file must be mode `0600` and owned by the backup operator. Using
libpq environment variables avoids placing the database password in a process
argument. The script also asks PostgreSQL to prove that the connected login is
the dedicated non-superuser, `BYPASSRLS`, default-read-only backup role before
it starts the dump.

The command uses a serializable, deferrable snapshot; writes a compressed
custom-format archive; parses the archive table of contents; encrypts it; and
writes SHA-256 and row/schema-count manifests. Upload the resulting `.age`,
`.sha256`, and `.manifest.tsv` files together. Storage lifecycle policy owns
retention; the script never deletes old backups.

Plaintext is blocked by default. `BACKUP_ALLOW_PLAINTEXT=true` is only for a
short-lived local/dev drill on an encrypted workstation and the dump must be
deleted when the drill ends.

### Restore drill

Run on an isolated PostgreSQL 16 cluster where the database roles have already
been provisioned. Never point this command at a production cluster.

```bash
export PGHOST=restore-db.internal
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD='...'
export PGDATABASE=postgres
export BACKUP_AGE_IDENTITY=/secure/path/backup-identity.txt
scripts/cluster/restore-verify.sh /backups/beaconhs-YYYYMMDDTHHMMSSZ.dump.age
```

The drill verifies the encrypted-file checksum, restores atomically into a
uniquely named disposable database, checks table/view/RLS/policy/migration and
key row counts against the manifest, checks FK validation and object ownership,
then drops the database. Set `KEEP_RESTORE_DB=true` only when an operator needs
to inspect the restored copy, and drop it manually afterward.

Record every drill date, archive timestamp, restore duration, and result in the
operations system. Run at least monthly and after PostgreSQL major-version or
backup-tool changes.

## Object storage

- The bucket must reject anonymous `GetObject` and list operations.
- Application reads use short-lived signed URLs; application uploads use
  single-use database reservations and verified pending-object promotion.
- Enable bucket encryption and versioning. The one-shot storage initializer
  idempotently installs one-day expiry rules for objects tagged
  `beaconhs-state=pending` (abandoned uploads) and
  `beaconhs-state=transient` (on-demand render hand-offs). Do not remove or
  broaden those two tag-scoped rules; durable attachments are intentionally
  untagged and are never selected by them.
- Run a daily referenced-key inventory. Alert on missing referenced objects and
  age unreferenced objects through a quarantine window before deletion.
- Back up or replicate irreplaceable objects to a separate account/region.
- Never reuse broad company-wide object credentials for BeaconHS.

## Redis and job recovery

Redis holds BullMQ queued/delayed work and rate-limit state. PostgreSQL remains
the source of record, but losing Redis can lose an unprocessed notification or
render job.

- Enable AOF with `appendfsync everysec` and durable storage.
- Monitor persistence failures, memory pressure, evictions, replication, and
  queue age/failure counts.
- Back up Redis according to the approved queue-loss tolerance.
- After recovery, restart the scheduler to re-register repeatable jobs and
  reconcile durable pending/outbox records before declaring recovery complete.

## Error monitoring

BeaconHS initializes Sentry only when `SENTRY_DSN` is non-empty. Set the same
DSN and an explicit `SENTRY_ENVIRONMENT` on web, worker, and scheduler. The web
image also receives that DSN at build time as `NEXT_PUBLIC_SENTRY_DSN` so client
render and navigation errors are captured. DSNs are public identifiers, but the
Sentry source-map auth token is not; never put an auth token in image build
arguments.

The SDK deliberately disables default PII collection and session replay. Do not
attach form values, job payloads, email bodies, document text, or capability
URLs to monitoring events. Alerts must cover new web errors, worker job
failures, scheduler registration failure, and a sudden absence of events. After
each environment is first configured, trigger a synthetic client error and a
synthetic server/worker error, verify release and environment tags, then remove
the synthetic path or job.

## Deployment and rollback

1. Back up and verify the schema/data before a destructive migration or private
   ETL refresh.
2. Run all local gates under the pinned Node/pnpm versions:
   `format:check`, `typecheck`, `lint`, `test`, and `build`.
3. Push an atomic commit to protected `main`.
4. CI must test the real migration path twice before building and publishing the
   commit-tagged image. The deployment captures the registry-returned
   `sha256` content digest and uses only `IMAGE_NAME@sha256:...` from that
   point forward; the commit tag is never used as a deployment identity. The
   reusable deployment rejects a run unless its full SHA is still
   the current remote `main` tip, checks again before publishing the image,
   before the first deployment-host mutation, and immediately before downtime.
   Never rerun a stale workflow attempt after `main` has advanced; dispatch the
   latest commit instead. Repository workflows retain read-only contents
   permission so they cannot advance `main` behind an in-flight release; CI
   enforces that invariant. No mutable `dev` image tag participates in deploys.
5. Before any writer metadata or downtime change, the deploy job rejects an
   unsupported multi-node dev Swarm, a Dokploy compose assigned to a remote
   server, competing app-host Traefik routes, outside BeaconHS writers, and
   outside containers or services using any target database role. It fails
   closed on route matchers it cannot audit,
   fingerprints the normalized raw router rules and labels, reconciles the
   reviewed Collabora routes, and persists the compose with
   `WRITER_REPLICAS=0`. That update also disables Dokploy auto-deploy, custom
   compose commands, service randomization, and isolated-deployment rewrites;
   only the audited raw Swarm-stack command may materialize the compose. The
   fenced metadata already points at the new immutable app and Collabora
   digests, so an unexpected zero-writer deploy cannot start an unreviewed
   one-shot image. The dev compose is also limited to exactly the primary app
   domain plus `/browser`, `/cool`, and `/hosting`; stale alternate hosts or
   path records block the cutover. The job then proves the exact persisted
   state, an empty target deployment queue, and no running target deployment.
6. The deploy job pre-pulls the exact build digest with its job-scoped,
   read-only GHCR token, without mutating Dokploy's existing registry login. It
   derives the compose's registry identity from `compose.one`, round-trips that
   exact value in both updates, and includes it in every later compose
   fingerprint. It requires the target stack to contain exactly the reviewed
   five services, and pauses scheduling on every active
   Swarm node before it drains the web, worker, and one-shot scheduler. Existing
   unrelated tasks keep running. It rejects BeaconHS writers or exact target-DB
   credentials in any outside Swarm service or standalone container. Immediately
   before migration, it re-enumerates every current node (including newly joined
   nodes), service, and container, then re-proves the scheduler fence, terminal
   old writer tasks, exact compose fingerprint, empty queue, routes, and no
   running target deployment.
7. Recovery is forward-only as soon as the migration runner starts. It commits
   independent schema, RLS, grant, authorization-data, statistics, and
   reporting-view phases, so an unchanged Drizzle ledger is not rollback proof.
   During the optional one-time data cutover, the job re-proves the Swarm
   scheduler and outside-writer isolation immediately before and after every
   mutating pass. After the initial drain, that proof also inspects target-stack
   task containers and fails if any database writer is still running; a changed
   fence stops the remaining cutover scripts.
   The workflow never automatically restores old writers after a migration
   failure. Repair by rerunning the exact SHA or by an explicit database
   restore/cutover; never point the old image at partially or fully converged
   current-code database state.
8. After schema and optional data cutover, the workflow restores
   `WRITER_REPLICAS=1` only alongside the exact new image, pinned Collabora
   digest, and complete reviewed environment. While every current node is still
   unavailable for new scheduling, it posts one uniquely marked Dokploy
   deployment, reconciles an ambiguous API response through the deployment
   ledger without re-posting, and requires a timestamped successful terminal
   state. It then re-reads the exact compose fingerprint, verifies all five
   materialized service specs, exact and unique environment key sets and values,
   placement, roles, digest-pinned images, replicas, and pending writer tasks.
   The pre-cutover audit accepts the currently running Collabora release only
   when it is digest-pinned, so a reviewed Collabora digest upgrade cannot
   deadlock the cutover; the post-deploy audit requires the newly configured
   digest exactly. Only after that final proof does it reactivate the nodes it
   paused.
9. The job requires exactly one target-stack web, worker, scheduler,
   storage-initializer, and Collabora service on their expected images. It then
   verifies task health/completion, exact-SHA external readiness, an exact HTML
   `200` from login, and strict PPTX/DOCX Collabora discovery before declaring
   the deployment healthy.
10. Roll application code back by exact image digest only when the database change
    is backward-safe. Database migrations are forward-only; otherwise restore to
    a new database from the pre-change backup and perform an explicit cutover.

The one-time dev data cutover must be dispatched from the **CI** workflow with
`operation=deploy-and-cutover`. That run executes every gate for the selected
`main` SHA before calling the reusable deploy workflow. The deploy workflow's
direct manual entrypoint is reserved for compose refresh-token rotation.

The scheduler fence is not a PostgreSQL login fence and cannot make an
administrator or a non-Docker external client participate in the transaction.
For every cutover window, suspend other Dokploy/UI/API deployment authority and
confirm no external process uses the BeaconHS runtime or cross-tenant database
credentials. A production cluster should add a dedicated cutover-only data role
and an admin-provisioned database fence that blocks and drains runtime sessions;
do not claim the Swarm-only dev procedure provides that stronger guarantee.

The dev compose currently serves Collabora on the BeaconHS app origin through
`/browser`, `/cool`, and `/hosting`. That topology is for the private dev
environment only: a compromised editor would share the app origin, cookies,
and browser storage. Before production traffic, give Collabora a dedicated
HTTPS origin with its own DNS/certificate and no parent-domain auth cookies;
set `COLLABORA_URL` to that origin while keeping `COLLABORA_WOPI_URL` on the app
origin. Keep that exact editor origin in `form-action`; `frame-src` also permits
HTTPS tenant-authored training embeds, which must remain sandboxed without form,
pop-up, or top-navigation privileges. Retain exact `event.origin` **and**
iframe-window source validation for every Collabora `postMessage`. Do not
approve the same-origin dev route set as a production exception.

Never disable a gate, edit a migration ledger, mark a failed migration as
applied, or point old code at a schema it does not understand.

If a failed run reports a retained Swarm scheduler fence, leave it in place
until the failed migration/data state is understood. Before changing node
availability manually, prefer dispatching the latest audited workflow. The
workflow records its claim in namespaced labels on the sole Swarm manager; a
later run reclaims the pause only when the repository, stack, node identity,
and complete label set still match. A manager paused without that exact claim,
or one changed to `drain`, fails closed as operator-owned state. The successful
release restores only the node that the workflow originally observed as
active, verifies it, and then removes only those namespaced claim labels.

## Private ETL cutover

The company-specific ETL package is intentionally ignored by Git. Its own
runbook and fingerprint/read-only guards remain authoritative. At minimum:

1. Stop legacy writes and scheduled integrations for the full refresh window.
2. Take and verify PostgreSQL and object-storage backups.
3. Confirm all six source databases with the read-only principal check and
   approved fingerprints.
4. Run the complete dry-run and review counts, key ranges, URLs, and target
   fingerprint.
5. Run the 98-table refresh/import once under its advisory lock.
6. Re-run dry-run/reconciliation, verify watermarks and attachment/object
   integrity, then resume writers.

## Secrets and incident response

- Rotate a credential immediately after suspected output/log exposure. Update
  the secret manager, canary the new credential, revoke the old one, and verify
  dependent services.
- Treat `BETTER_AUTH_SECRET` as an encryption key, not only a session secret. A
  rotation requires a planned reseal/invalidation procedure for stored provider
  secrets, kiosk PIN peppers, and signed editor/session tokens.
- Keep `ATTACHMENT_CAPABILITY_SECRET` separate and stable across every web
  replica and deployment. Rotating it immediately invalidates every persisted
  attachment URL; rotate only with a coordinated capability-URL backfill.
- Attachment capabilities remain session- and tenant-RLS-gated, but are still
  bearer material. Configure reverse-proxy/access logs to redact the `cap`
  query parameter and never copy capability URLs into incident tickets. The
  attachment route sets `Referrer-Policy: no-referrer` on its redirect.
- Preserve GitHub Actions, Dokploy, application, PostgreSQL, Redis, and object
  audit evidence during an incident. Do not paste secret-bearing logs into a
  public issue.
- Readiness returning green is necessary but not sufficient: verify a real
  tenant-scoped read, worker dependency health, queue progress, and storage
  signed read/write after recovery.
