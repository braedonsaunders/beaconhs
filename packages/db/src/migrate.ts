import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { RLS_POLICY_SQL, TENANT_SCOPED_TABLES } from './rls'
import { REPORT_VIEWS_SQL } from './views'
import { STATS_SQL, STATS_HIGH_VOLUME_TABLES } from './stats'
import { BUILTIN_ROLES, PERMISSION_CATALOGUE } from './schema'
import {
  readMigrationFiles,
  validateMigrationState,
  type MigrationTrackerRow,
} from './migration-state'

type MigrationDatabase = ReturnType<typeof drizzle>

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url))
const MIGRATION_FILES = readMigrationFiles(MIGRATIONS_FOLDER)
const MIGRATION_CUTOVER_AT = 1783884000000
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/

function roleIdentifier(role: string): string {
  if (!ROLE_NAME.test(role)) throw new Error(`Invalid database role name: ${role}`)
  return `"${role}"`
}

function firstRow<T = Record<string, unknown>>(result: unknown): T | undefined {
  const rows = (result as { rows?: T[] }).rows ?? (result as T[])
  return rows[0]
}

async function verifyMigrationTracker(db: MigrationDatabase, requireComplete: boolean) {
  const appTable = firstRow<{ exists: string | null }>(
    await db.execute(sql`select to_regclass('public.tenants')::text as exists`),
  )?.exists
  if (!appTable) {
    if (requireComplete) throw new Error('Migrations completed without creating public.tenants')
    console.log('  Fresh database detected; the full migration journal will run')
    return
  }

  const trackerTable = firstRow<{ exists: string | null }>(
    await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations')::text as exists`),
  )?.exists
  if (!trackerTable) {
    throw new Error(
      'Existing BeaconHS schema has no drizzle migration tracker. Refusing to mark migrations applied without validating the physical schema.',
    )
  }

  const rows = (await db.execute(sql`
    select hash, created_at
    from "drizzle"."__drizzle_migrations"
    order by created_at
  `)) as unknown as Array<{ hash: string; created_at: MigrationTrackerRow['createdAt'] }>
  const state = validateMigrationState(
    MIGRATION_FILES,
    rows.map((row) => ({ hash: row.hash, createdAt: row.created_at })),
    { allowLegacyBefore: MIGRATION_CUTOVER_AT, requireComplete },
  )
  console.log(
    `  Migration ledger valid: ${state.applied.length} applied, ${state.pending.length} pending, ${state.unknownTrackerRows} historical`,
  )
}

async function assertKioskPinHashes(db: MigrationDatabase) {
  type CountRow = { count: number }
  const tenantCount = firstRow<CountRow>(
    await db.execute(sql`
      select count(*)::integer as count
      from tenants
      where kiosk_pin is not null
        and kiosk_pin <> ''
        and kiosk_pin not like 'bhs_pin_scrypt_v1$%'
    `),
  )?.count
  const stationCount = firstRow<CountRow>(
    await db.execute(sql`
      select count(*)::integer as count
      from equipment_station_settings
      where station_pin is not null
        and station_pin <> ''
        and station_pin not like 'bhs_pin_scrypt_v1$%'
    `),
  )?.count

  if ((tenantCount ?? 0) > 0 || (stationCount ?? 0) > 0) {
    throw new Error(
      `Unhashed kiosk PIN invariant failed (${tenantCount ?? 0} tenant, ${stationCount ?? 0} station). Refusing to deploy until the explicit PIN migration is completed.`,
    )
  }
  console.log('✔ Kiosk PIN hash invariant verified')
}

async function convergeRolePermissions(db: MigrationDatabase) {
  const fullCatalogueJson = JSON.stringify(PERMISSION_CATALOGUE)

  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as MigrationDatabase
    // Clean cutover: remove retired/unknown keys from built-in and custom roles
    // before adding the current built-in baseline. This prevents deleted
    // capabilities from surviving indefinitely as inert authorization data.
    await tx.execute(sql`
      update "roles"
      set "permissions" = (
            select coalesce(jsonb_agg(current_permission."permission" order by current_permission."permission"), '[]'::jsonb)
            from jsonb_array_elements_text("roles"."permissions") as current_permission("permission")
            where ${fullCatalogueJson}::jsonb ? current_permission."permission"
          ),
          "updated_at" = now()
      where exists (
        select 1
        from jsonb_array_elements_text("roles"."permissions") as current_permission("permission")
        where not (${fullCatalogueJson}::jsonb ? current_permission."permission")
      )
    `)

    await tx.execute(sql`
      update "roles"
      set "permissions" = ${fullCatalogueJson}::jsonb,
          "updated_at" = now()
      where "key" = 'tenant_admin'
        and "is_built_in" = true
        and "permissions" <> ${fullCatalogueJson}::jsonb
    `)

    for (const [key, def] of Object.entries(BUILTIN_ROLES)) {
      if (key === 'tenant_admin') continue
      const baselineJson = JSON.stringify(def.permissions)
      await tx.execute(sql`
        update "roles"
        set "permissions" = (
              select coalesce(jsonb_agg("permission" order by "permission"), '[]'::jsonb)
              from (
                select distinct "permission"
                from (
                  select jsonb_array_elements_text("roles"."permissions") as "permission"
                  union
                  select jsonb_array_elements_text(${baselineJson}::jsonb) as "permission"
                ) as combined_permissions
              ) as deduped_permissions
            ),
            "updated_at" = now()
        where "key" = ${key}
          and "is_built_in" = true
          and exists (
            select 1
            from jsonb_array_elements_text(${baselineJson}::jsonb) as baseline("permission")
            where not ("roles"."permissions" ? baseline."permission")
          )
      `)
    }
  })

  console.log('✔ Built-in role permissions backfilled')
}

async function assumeOwnerRole(migrationDb: MigrationDatabase, ownerRole: string) {
  const membership = firstRow<{
    login_role: string
    can_assume: boolean
    login_super: boolean
    login_bypass_rls: boolean
    owner_can_login: boolean
    owner_super: boolean
    owner_bypass_rls: boolean
  }>(
    await migrationDb.execute(sql`
      select
        session_user as login_role,
        pg_has_role(session_user, ${ownerRole}, 'MEMBER') as can_assume,
        login.rolsuper as login_super,
        login.rolbypassrls as login_bypass_rls,
        owner.rolcanlogin as owner_can_login,
        owner.rolsuper as owner_super,
        owner.rolbypassrls as owner_bypass_rls
      from pg_roles login
      join pg_roles owner on owner.rolname = ${ownerRole}
      where login.rolname = session_user
    `),
  )
  if (!membership) throw new Error(`Database owner role ${ownerRole} does not exist`)
  if (!membership.can_assume) {
    throw new Error(`Migration login ${membership.login_role} cannot SET ROLE ${ownerRole}`)
  }
  if (membership.login_super || membership.login_bypass_rls) {
    throw new Error('Migration login must not be SUPERUSER or BYPASSRLS')
  }
  if (membership.owner_can_login || membership.owner_super || membership.owner_bypass_rls) {
    throw new Error(`Owner role ${ownerRole} must be NOLOGIN, NOSUPERUSER, and NOBYPASSRLS`)
  }

  await migrationDb.execute(sql.raw(`SET ROLE ${roleIdentifier(ownerRole)}`))
}

async function assertDatabaseRoles(
  migrationDb: MigrationDatabase,
  runtimeDb: MigrationDatabase,
  maintenanceDb: MigrationDatabase,
  expectedOwner: string,
  expectedBackup: string,
) {
  const migration = firstRow<{ login_role: string; owner_role: string }>(
    await migrationDb.execute(sql`select session_user as login_role, current_user as owner_role`),
  )
  const runtime = firstRow<{
    role: string
    is_super: boolean
    bypass_rls: boolean
    owner_member: boolean
  }>(
    await runtimeDb.execute(sql`
      select
        current_user as role,
        rolsuper as is_super,
        rolbypassrls as bypass_rls,
        pg_has_role(current_user, ${expectedOwner}, 'MEMBER') as owner_member
      from pg_roles
      where rolname = current_user
    `),
  )
  const maintenance = firstRow<{
    role: string
    is_super: boolean
    bypass_rls: boolean
    owner_member: boolean
  }>(
    await maintenanceDb.execute(sql`
      select
        current_user as role,
        rolsuper as is_super,
        rolbypassrls as bypass_rls,
        pg_has_role(current_user, ${expectedOwner}, 'MEMBER') as owner_member
      from pg_roles
      where rolname = current_user
    `),
  )
  const backup = firstRow<{
    role: string
    can_login: boolean
    is_super: boolean
    bypass_rls: boolean
    owner_member: boolean
    read_only: boolean
  }>(
    await migrationDb.execute(sql`
      select
        rolname as role,
        rolcanlogin as can_login,
        rolsuper as is_super,
        rolbypassrls as bypass_rls,
        pg_has_role(rolname, ${expectedOwner}, 'MEMBER') as owner_member,
        coalesce(rolconfig @> array['default_transaction_read_only=on']::text[], false) as read_only
      from pg_roles
      where rolname = ${expectedBackup}
    `),
  )
  if (!migration || !runtime || !maintenance || !backup) {
    throw new Error('Unable to resolve database roles for migration preflight')
  }
  if (migration.owner_role !== expectedOwner) {
    throw new Error(
      `Migration login ${migration.login_role} did not assume expected owner role ${expectedOwner}`,
    )
  }
  const distinctRoles = new Set([
    migration.login_role,
    migration.owner_role,
    runtime.role,
    maintenance.role,
    backup.role,
  ])
  if (distinctRoles.size !== 5) {
    throw new Error(
      'Migration login, owner, runtime, maintenance, and backup roles must all be distinct',
    )
  }
  if (runtime.is_super || runtime.bypass_rls || runtime.owner_member) {
    throw new Error(
      `Runtime role ${runtime.role} must be NOSUPERUSER, NOBYPASSRLS, and not a member of ${expectedOwner}`,
    )
  }
  if (maintenance.is_super || !maintenance.bypass_rls || maintenance.owner_member) {
    throw new Error(
      `Maintenance role ${maintenance.role} must be non-superuser BYPASSRLS and not a member of ${expectedOwner}`,
    )
  }
  if (
    !backup.can_login ||
    backup.is_super ||
    !backup.bypass_rls ||
    backup.owner_member ||
    !backup.read_only
  ) {
    throw new Error(
      `Backup role ${backup.role} must be LOGIN, non-superuser BYPASSRLS, non-owner, and default_transaction_read_only=on`,
    )
  }

  const tableOwner = firstRow<{ owner: string | null }>(
    await migrationDb.execute(sql`
      select pg_get_userbyid(c.relowner) as owner
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'tenants'
    `),
  )?.owner
  if (tableOwner && tableOwner !== expectedOwner) {
    throw new Error(`Existing app tables are owned by ${tableOwner}; expected ${expectedOwner}`)
  }
  console.log(
    `✔ Database role preflight passed (${migration.login_role} → ${expectedOwner}; runtime ${runtime.role}; maintenance ${maintenance.role}; backup ${backup.role})`,
  )

  return {
    runtimeRole: runtime.role,
    maintenanceRole: maintenance.role,
    backupRole: backup.role,
  }
}

async function applyRuntimeGrants(
  db: MigrationDatabase,
  ownerRole: string,
  runtimeRole: string,
  maintenanceRole: string,
  backupRole: string,
) {
  const owner = roleIdentifier(ownerRole)
  const runtime = roleIdentifier(runtimeRole)
  const maintenance = roleIdentifier(maintenanceRole)
  const backup = roleIdentifier(backupRole)
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as MigrationDatabase
    for (const statement of [
      `REVOKE CREATE ON SCHEMA public FROM PUBLIC, ${runtime}, ${maintenance}`,
      `REVOKE CREATE ON SCHEMA public FROM ${backup}`,
      `GRANT USAGE ON SCHEMA public TO ${runtime}, ${maintenance}, ${backup}`,
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${runtime}, ${maintenance}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtime}, ${maintenance}`,
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${runtime}, ${maintenance}`,
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${runtime}, ${maintenance}`,
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${backup}`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${backup}`,
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${backup}`,
      `GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${backup}`,
      `GRANT USAGE ON SCHEMA drizzle TO ${backup}`,
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA drizzle FROM ${backup}`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO ${backup}`,
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA drizzle FROM ${backup}`,
      `GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO ${backup}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtime}, ${maintenance}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${runtime}, ${maintenance}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT ON TABLES TO ${backup}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${backup}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA drizzle GRANT SELECT ON TABLES TO ${backup}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA drizzle GRANT SELECT ON SEQUENCES TO ${backup}`,
    ]) {
      await tx.execute(sql.raw(statement))
    }
  })
  console.log(
    `✔ Least-privilege grants applied (runtime ${runtimeRole}; maintenance ${maintenanceRole}; backup ${backupRole})`,
  )
}

async function applyRlsPolicies(db: MigrationDatabase) {
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as MigrationDatabase
    for (const table of TENANT_SCOPED_TABLES) {
      try {
        await tx.execute(sql.raw(RLS_POLICY_SQL(table)))
      } catch (error) {
        throw new Error(`RLS policy installation failed for ${table}`, { cause: error })
      }
    }
  })
  console.log(`✔ RLS applied atomically (${TENANT_SCOPED_TABLES.length} tables)`)
}

async function applyPlannerStatistics(db: MigrationDatabase) {
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as MigrationDatabase
    for (const statement of STATS_SQL) await tx.execute(sql.raw(statement))
  })
  for (const table of STATS_HIGH_VOLUME_TABLES) {
    await db.execute(sql.raw(`ANALYZE ${table};`))
  }
  console.log(`✔ Statistics applied (${STATS_SQL.length} targets)`)
}

async function applyReportingViews(db: MigrationDatabase) {
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as MigrationDatabase
    for (const viewSql of REPORT_VIEWS_SQL) await tx.execute(sql.raw(viewSql))
  })
  console.log(`✔ Views applied atomically (${REPORT_VIEWS_SQL.length} statements)`)
}

async function main() {
  // DDL uses a dedicated unpooled login that can SET ROLE to a NOLOGIN owner.
  // Runtime and cross-tenant maintenance are distinct, non-owner logins.
  const migrationUrl = process.env.MIGRATION_DATABASE_URL
  const runtimeUrl = process.env.DATABASE_URL
  const maintenanceUrl = process.env.SUPERADMIN_DATABASE_URL
  const ownerRole = process.env.DATABASE_OWNER_ROLE ?? 'beaconhs_owner'
  const backupRole = process.env.DATABASE_BACKUP_ROLE ?? 'beaconhs_backup'
  roleIdentifier(ownerRole)
  roleIdentifier(backupRole)
  if (!migrationUrl) throw new Error('MIGRATION_DATABASE_URL is required for migrations')
  if (!runtimeUrl) throw new Error('DATABASE_URL is required for runtime-role validation')
  if (!maintenanceUrl) {
    throw new Error('SUPERADMIN_DATABASE_URL is required for cross-tenant migration maintenance')
  }

  const migrationClient = postgres(migrationUrl, {
    max: 1,
    prepare: false,
    // Idempotent policy/view installation deliberately uses DROP ... IF EXISTS
    // across hundreds of objects. PostgreSQL emits one NOTICE for every absent
    // object; suppress those protocol notices so deploy logs retain the explicit
    // phase summaries and actionable warnings/errors instead of thousands of
    // expected "does not exist, skipping" records.
    onnotice: () => undefined,
  })
  const runtimeClient = postgres(runtimeUrl, { max: 1, prepare: false })
  const maintenanceClient = postgres(maintenanceUrl, { max: 1, prepare: false })
  const migrationDb = drizzle(migrationClient)
  const runtimeDb = drizzle(runtimeClient)
  const maintenanceDb = drizzle(maintenanceClient)
  let lockAcquired = false

  try {
    await assumeOwnerRole(migrationDb, ownerRole)
    const roles = await assertDatabaseRoles(
      migrationDb,
      runtimeDb,
      maintenanceDb,
      ownerRole,
      backupRole,
    )
    await migrationDb.execute(sql`select pg_advisory_lock(hashtext('beaconhs:schema-migration'))`)
    lockAcquired = true

    console.log('▶ Validating migration ledger…')
    await verifyMigrationTracker(migrationDb, false)

    console.log('▶ Running drizzle migrations…')
    await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER })
    await verifyMigrationTracker(migrationDb, true)

    console.log('▶ Applying RLS policies…')
    await applyRlsPolicies(migrationDb)

    console.log('▶ Applying least-privilege runtime grants…')
    await applyRuntimeGrants(
      migrationDb,
      ownerRole,
      roles.runtimeRole,
      roles.maintenanceRole,
      roles.backupRole,
    )

    console.log('▶ Verifying security data invariants…')
    await assertKioskPinHashes(maintenanceDb)

    console.log('▶ Converging role permissions…')
    await convergeRolePermissions(maintenanceDb)

    console.log('▶ Applying planner statistics targets…')
    await applyPlannerStatistics(migrationDb)

    console.log('▶ Applying reporting views…')
    await applyReportingViews(migrationDb)
  } finally {
    if (lockAcquired) {
      try {
        await migrationDb.execute(
          sql`select pg_advisory_unlock(hashtext('beaconhs:schema-migration'))`,
        )
      } catch (error) {
        console.warn('Migration advisory lock will be released when the connection closes', error)
      }
    }
    await Promise.all([migrationClient.end(), runtimeClient.end(), maintenanceClient.end()])
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
