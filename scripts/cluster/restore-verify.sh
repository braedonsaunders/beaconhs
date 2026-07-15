#!/bin/sh
set -eu

umask 077

archive_input=${1:-}
if [ -z "$archive_input" ] || [ ! -f "$archive_input" ]; then
  echo 'Usage: scripts/cluster/restore-verify.sh /path/to/beaconhs-*.dump[.age]' >&2
  exit 1
fi
: "${PGHOST:?Set PGHOST for the disposable restore cluster}"
: "${PGUSER:?Set PGUSER to a PostgreSQL administrator on the disposable restore cluster}"

for command_name in createdb dropdb pg_restore psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

owner_role=${DATABASE_OWNER_ROLE:-beaconhs_owner}
case "$owner_role" in
  *[!a-z0-9_]* | '')
    echo 'DATABASE_OWNER_ROLE contains invalid characters.' >&2
    exit 1
    ;;
esac

archive="$archive_input"
decrypted_tmp=''
actual_manifest=''
if [ "${archive_input##*.}" = 'age' ]; then
  : "${BACKUP_AGE_IDENTITY:?Set BACKUP_AGE_IDENTITY to decrypt this backup}"
  if ! command -v age >/dev/null 2>&1; then
    echo 'The age command is required to decrypt this backup.' >&2
    exit 1
  fi
  decrypted_tmp=$(mktemp "${TMPDIR:-/tmp}/beaconhs-restore.XXXXXX.dump")
  age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$decrypted_tmp" "$archive_input"
  archive="$decrypted_tmp"
fi

database="beaconhs_restore_$(date -u '+%Y%m%d%H%M%S')_$$"
admin_database=${PGDATABASE:-postgres}
keep_database=${KEEP_RESTORE_DB:-false}

cleanup() {
  if [ "$keep_database" != 'true' ]; then
    dropdb --if-exists --maintenance-db="$admin_database" "$database" >/dev/null 2>&1 || true
  fi
  if [ -n "$decrypted_tmp" ]; then rm -f "$decrypted_tmp"; fi
  if [ -n "$actual_manifest" ]; then rm -f "$actual_manifest"; fi
}
trap cleanup EXIT HUP INT TERM

checksum_file="$archive_input.sha256"
if [ -f "$checksum_file" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$archive_input")" && sha256sum --check "$(basename "$checksum_file")")
  else
    expected=$(awk '{print $1}' "$checksum_file")
    actual=$(shasum -a 256 "$archive_input" | awk '{print $1}')
    if [ "$expected" != "$actual" ]; then
      echo 'Backup checksum verification failed.' >&2
      exit 1
    fi
  fi
fi

pg_restore --list "$archive" >/dev/null
archive_creates_public_schema=$(
  pg_restore --list "$archive" |
    awk '$4 == "SCHEMA" && $5 == "-" && $6 == "public" { print "true"; exit }'
)

createdb --maintenance-db="$admin_database" --template=template0 --owner="$owner_role" "$database"
# PostgreSQL creates public in every new database. A pg_dump archive also owns
# that schema when BeaconHS has transferred it to the dedicated owner, so the
# restore would otherwise fail with "schema public already exists". Drop only
# the empty schema in this brand-new disposable database, and only when the
# validated archive declares that it will recreate it.
if [ "$archive_creates_public_schema" = 'true' ]; then
  PGDATABASE="$database" psql -X -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA public;
SQL
fi
PGDATABASE="$database" pg_restore \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  --role="$owner_role" \
  --dbname="$database" \
  "$archive"

actual_manifest=$(mktemp "${TMPDIR:-/tmp}/beaconhs-manifest.XXXXXX")
PGDATABASE="$database" psql -X -v ON_ERROR_STOP=1 -At -F '	' >"$actual_manifest" <<'SQL'
select 'public_tables', count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p');
select 'public_views', count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m');
select 'forced_rls_tables', count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relforcerowsecurity;
select 'tenant_policies', count(*)::text from pg_policies where schemaname='public' and policyname='tenant_isolation';
select 'migration_rows', count(*)::text from drizzle.__drizzle_migrations;
select 'tenants', count(*)::text from public.tenants;
select 'attachments', count(*)::text from public.attachments;
select 'form_responses', count(*)::text from public.form_responses;
select 'invalid_foreign_keys', count(*)::text from pg_constraint where contype='f' and not convalidated;
SQL

# The final owner query uses a transaction-local setting so the role name is a
# bound value rather than interpolated SQL.
wrong_owner=$(PGDATABASE="$database" psql -X -v ON_ERROR_STOP=1 -At \
  -v owner_role="$owner_role" <<'SQL'
select count(*)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'S')
  and pg_get_userbyid(c.relowner) <> :'owner_role';
SQL
)
if [ "$wrong_owner" != '0' ]; then
  echo "Restore verification found $wrong_owner public objects with the wrong owner." >&2
  exit 1
fi

manifest="$archive_input.manifest.tsv"
if [ -f "$manifest" ]; then
  while IFS="$(printf '\t')" read -r key expected; do
    case "$key" in
      public_tables | public_views | forced_rls_tables | tenant_policies | migration_rows | tenants | attachments | form_responses)
        actual=$(awk -F '\t' -v wanted="$key" '$1 == wanted { print $2 }' "$actual_manifest")
        if [ "$actual" != "$expected" ]; then
          echo "Restore verification mismatch for $key: expected $expected, got $actual" >&2
          exit 1
        fi
        ;;
    esac
  done <"$manifest"
fi

invalid_foreign_keys=$(awk -F '\t' '$1 == "invalid_foreign_keys" { print $2 }' "$actual_manifest")
rm -f "$actual_manifest"
actual_manifest=''
if [ "$invalid_foreign_keys" != '0' ]; then
  echo "Restore contains $invalid_foreign_keys unvalidated foreign keys." >&2
  exit 1
fi

if [ "$keep_database" = 'true' ]; then
  echo "Restore verified and retained: $database"
else
  echo "Restore verified; disposable database will be removed: $database"
fi
