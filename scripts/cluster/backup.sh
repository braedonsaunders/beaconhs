#!/bin/sh
set -eu

umask 077

: "${PGHOST:?Set PGHOST to the PostgreSQL host}"
: "${PGDATABASE:?Set PGDATABASE to the BeaconHS database}"
: "${PGUSER:?Set PGUSER to the read-only BeaconHS backup login}"

output_dir=${1:-backups}
recipient=${BACKUP_AGE_RECIPIENT:-}
allow_plaintext=${BACKUP_ALLOW_PLAINTEXT:-false}

if [ -z "$recipient" ] && [ "$allow_plaintext" != 'true' ]; then
  echo 'Refusing to write an unencrypted database backup. Set BACKUP_AGE_RECIPIENT or explicitly set BACKUP_ALLOW_PLAINTEXT=true for a disposable local drill.' >&2
  exit 1
fi
if [ -n "$recipient" ] && ! command -v age >/dev/null 2>&1; then
  echo 'BACKUP_AGE_RECIPIENT is set, but the age command is unavailable.' >&2
  exit 1
fi

for command_name in pg_dump pg_restore psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

expected_backup_role=${DATABASE_BACKUP_ROLE:-beaconhs_backup}
role_state=$(PGCONNECT_TIMEOUT=10 psql -X -v ON_ERROR_STOP=1 -At -F '|' <<'SQL'
select
  current_user,
  r.rolcanlogin,
  r.rolsuper,
  r.rolbypassrls,
  current_setting('default_transaction_read_only')
from pg_roles r
where r.rolname = current_user;
SQL
)
IFS='|' read -r connected_role role_can_login role_super role_bypass role_read_only <<EOF
$role_state
EOF
if [ "$connected_role" != "$expected_backup_role" ] || [ "$role_can_login" != 't' ] || \
  [ "$role_super" != 'f' ] || [ "$role_bypass" != 't' ] || [ "$role_read_only" != 'on' ]; then
  echo "Refusing backup: connected role must be $expected_backup_role (LOGIN, NOSUPERUSER, BYPASSRLS, default read-only)." >&2
  exit 1
fi

mkdir -p "$output_dir"
timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
base="$output_dir/beaconhs-$timestamp.dump"
archive_tmp="$output_dir/.beaconhs-$timestamp.dump.tmp"
manifest_tmp="$output_dir/.beaconhs-$timestamp.manifest.tmp"

cleanup() {
  rm -f "$archive_tmp" "$manifest_tmp"
}
trap cleanup EXIT HUP INT TERM

echo 'Creating consistent logical backup…'
PGCONNECT_TIMEOUT=10 pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --serializable-deferrable \
  --lock-wait-timeout=30s \
  --file="$archive_tmp"

# Parsing the complete table of contents catches a truncated/corrupt custom
# archive before it can be promoted to the backup destination.
pg_restore --list "$archive_tmp" >/dev/null

PGCONNECT_TIMEOUT=10 psql -X -v ON_ERROR_STOP=1 -At -F '	' >"$manifest_tmp" <<'SQL'
select 'created_at_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
select 'server_version', current_setting('server_version');
select 'database_size_bytes', pg_database_size(current_database())::text;
select 'public_tables', count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p');
select 'public_views', count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m');
select 'forced_rls_tables', count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relforcerowsecurity;
select 'tenant_policies', count(*)::text from pg_policies where schemaname='public' and policyname='tenant_isolation';
select 'migration_rows', count(*)::text from drizzle.__drizzle_migrations;
select 'tenants', count(*)::text from public.tenants;
select 'attachments', count(*)::text from public.attachments;
select 'form_responses', count(*)::text from public.form_responses;
SQL

if [ -n "$recipient" ]; then
  final="$base.age"
  age --recipient "$recipient" --output "$final" "$archive_tmp"
else
  final="$base"
  mv "$archive_tmp" "$final"
fi

final_dir=$(dirname "$final")
final_name=$(basename "$final")
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$final_dir" && sha256sum "$final_name" >"$final_name.sha256")
else
  (cd "$final_dir" && shasum -a 256 "$final_name" >"$final_name.sha256")
fi
mv "$manifest_tmp" "$final.manifest.tsv"

trap - EXIT HUP INT TERM
cleanup
echo "Backup verified: $final"
