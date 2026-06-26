// Backfill the new hazid/inspections WRITE permissions onto existing roles.
//
// Hazard assessments and inspections gained dedicated write permissions
// (`<prefix>.create` / `<prefix>.update`) so their record-mutation server
// actions can be gated. Before this, those actions were ungated — ANY
// authenticated tenant member could create/edit them. To preserve that
// existing access while making it gated + configurable, we grant the two write
// keys to every role that already holds ANY read tier for the module (i.e. the
// roles that interact with it today). A role with no read tier for the module
// gets nothing. Per-record scope is still enforced separately via canSeeRecord.
//
// A role also receives the write perms if its KEY matches a built-in role whose
// (current) definition includes them — this brings already-seeded worker/foreman/
// safety_manager/tenant_admin rows up to the new baseline even when they never
// stored an explicit `*.read.self` string (the visibility resolver defaults to
// `self`, so workers read their own records without holding the literal perm).
//
// Idempotent: a re-run finds the write keys already present and grants nothing.
// Never downgrades / removes anything.
//
// Connects via the BYPASSRLS super pool (SUPERADMIN_DATABASE_URL / beaconhs_super) —
// the role-table RLS is a single `tenant_id` equality with no `app.bypass_rls`
// escape hatch, so it must run as beaconhs_super to see/update every tenant's roles:
//   pnpm --filter @beaconhs/db exec tsx src/scripts/backfill-hazid-inspections-write.ts

import { eq } from 'drizzle-orm'
import { createSuperClient } from '../client'
import * as s from '../schema'

// Modules that gained write permissions, with the read tiers that mark a role
// as "interacts with this module today".
const MODULES = ['hazid', 'inspections'] as const

function readsModule(perms: Set<string>, prefix: string): boolean {
  return (
    perms.has(`${prefix}.read.all`) ||
    perms.has(`${prefix}.read.site`) ||
    perms.has(`${prefix}.read.self`)
  )
}

async function main() {
  const { db, sql: pg } = createSuperClient({ max: 1 })

  const summary = await db.transaction(async (tx) => {
    const roles = await tx
      .select({ id: s.roles.id, key: s.roles.key, permissions: s.roles.permissions })
      .from(s.roles)

    let updated = 0
    let granted = 0
    for (const role of roles) {
      const perms = new Set<string>(role.permissions ?? [])
      const builtin = s.BUILTIN_ROLES[role.key as keyof typeof s.BUILTIN_ROLES]
      const builtinPerms = builtin
        ? new Set<string>(builtin.permissions as unknown as string[])
        : null
      const additions: string[] = []
      for (const prefix of MODULES) {
        const readsToday = readsModule(perms, prefix)
        for (const action of ['create', 'update'] as const) {
          const key = `${prefix}.${action}`
          if (perms.has(key)) continue
          // Grant if the role reads the module today (custom roles keep their
          // prior ungated write access) OR its built-in definition now includes
          // the write perm (brings seeded built-in roles to the new baseline).
          if (readsToday || builtinPerms?.has(key)) additions.push(key)
        }
      }
      if (additions.length === 0) continue

      const next = [...(role.permissions ?? []), ...additions]
      await tx
        .update(s.roles)
        .set({ permissions: next as never })
        .where(eq(s.roles.id, role.id))
      updated++
      granted += additions.length
      console.log(`  ${role.key} (${role.id.slice(0, 8)}) +${additions.join(', ')}`)
    }
    return { updated, granted, scanned: roles.length }
  })

  console.log(
    `✔ hazid/inspections write backfill — ${summary.granted} grants across ${summary.updated} role(s) (${summary.scanned} scanned)`,
  )
  await pg.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
