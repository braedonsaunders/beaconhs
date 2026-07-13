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
and, for a Cloudflare R2 endpoint, requires
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
DOKPLOY_REGISTRY_ID
DOKPLOY_TOKEN
DOKPLOY_URL
R2_ACCESS_KEY_ID
R2_BUCKET
R2_ENDPOINT
R2_SECRET_ACCESS_KEY
RESEND_API_KEY
VAPID_PRIVATE_KEY
VAPID_PUBLIC_KEY
VAPID_SUBJECT
```

`R2_PRIVATE_BUCKET_CONFIRMED` is additionally required when `R2_ENDPOINT` is a
Cloudflare `r2.cloudflarestorage.com` endpoint. It is unused for the private dev
MinIO-compatible endpoint.

`SENTRY_DSN` is warning-only for the dev deployment so a monitoring-provider
outage does not block schema recovery, but it remains mandatory before
production traffic is accepted. `GITHUB_TOKEN` is created by Actions and is
scoped per job: package write for image build, package read for deployment, and
no permissions for the maintenance/preflight jobs.

`DEV_DIRECT_DATABASE_URL` and `R2_PUBLIC_URL` are retired names and are not
consumed by the workflow or containers. Remove stale repository entries rather
than reintroducing either variable.

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
- Enable bucket encryption and versioning. Keep the pending-upload lifecycle
  rule at one day so abandoned uploads do not accumulate.
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
4. CI must test the real migration path twice before building the immutable SHA
   image.
5. The deploy job pre-pulls the exact SHA, discovers the current BeaconHS Swarm
   web, worker, and one-shot scheduler services, records their desired replicas
   in a runner-private temporary file, and drains them before migrating with the
   migration-only login. If the drain fails, or the migration command fails and
   the migration ledger proves its schema transaction rolled back, it restores
   the prior replica counts and verifies the persistent writers return.
6. As soon as the migration ledger advances, recovery is forward-only even if a
   later migration phase or deployment step fails. The old writer services
   remain stopped until Dokploy deploys the new SHA. Repair by redeploying that
   SHA or by an explicit database restore/cutover; never point the old image at
   the migrated schema.
7. The job verifies web, worker, scheduler, readiness, login, and Collabora
   discovery before declaring the deployment healthy.
8. Roll application code back by exact image SHA only when the database change
   is backward-safe. Database migrations are forward-only; otherwise restore to
   a new database from the pre-change backup and perform an explicit cutover.

Never disable a gate, edit a migration ledger, mark a failed migration as
applied, or point old code at a schema it does not understand.

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
