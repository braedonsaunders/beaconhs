// Backfill per-module record-visibility read tiers onto existing roles, so the
// newly-enforced "most people see only their own" model PRESERVES the access
// current managers/admins already have.
//
// For each role we derive ONE record tier from the perms it already holds:
//   `all`  — it holds an elevated/admin perm, or any existing `*.read.all`
//   `site` — its widest existing record tier is `*.read.site`
//   `self` — anything else (the resolver's DEFAULT, so nothing to grant)
// and grant the matching `<prefix>.read.<tier>` for each of the five record
// modules it lacks a tier for. We only ever grant `all`/`site` (a role with no
// tier already resolves to `self` via resolveVisibilityTier) and NEVER downgrade.
// Idempotent: a re-run finds the tiers already present and grants nothing.
//
//   pnpm --filter @beaconhs/db exec tsx src/scripts/backfill-record-visibility.ts
//
// Roles are tenant-RLS'd; this connects via the BYPASSRLS super pool
// (SUPERADMIN_DATABASE_URL / role beaconhs_super), so it reads + updates every
// tenant's roles without the dead `app.bypass_rls` GUC.

import { eq } from 'drizzle-orm'
import { createSuperClient } from '../client'
import * as s from '../schema'

// The five record modules now enforcing per-user visibility.
const PREFIXES = ['incidents', 'ca', 'forms.response', 'inspections', 'hazid'] as const

// Holding any of these marks a role as elevated → record tier `all`.
const ELEVATED = [
  'incidents.investigate',
  'incidents.close',
  'ca.verify',
  'admin.roles.manage',
  'admin.users.manage',
  'admin.settings.manage',
  'admin.org.manage',
]

// Existing record read tiers we read a role's current "widest" level from.
const TIER_SOURCES = ['incidents', 'ca', 'journals', 'forms.response', 'inspections', 'hazid']

type Tier = 'all' | 'site' | 'self'

function computeTier(perms: Set<string>): Tier {
  let widest = 0 // 0 none · 1 self · 2 site · 3 all
  for (const t of TIER_SOURCES) {
    if (perms.has(`${t}.read.all`)) widest = Math.max(widest, 3)
    else if (perms.has(`${t}.read.site`)) widest = Math.max(widest, 2)
    else if (perms.has(`${t}.read.self`)) widest = Math.max(widest, 1)
  }
  if (ELEVATED.some((k) => perms.has(k))) widest = 3
  return widest >= 3 ? 'all' : widest === 2 ? 'site' : 'self'
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
      const tier = computeTier(perms)
      if (tier === 'self') continue // default already yields self — nothing to add

      const additions: string[] = []
      for (const prefix of PREFIXES) {
        const hasTier =
          perms.has(`${prefix}.read.all`) ||
          perms.has(`${prefix}.read.site`) ||
          perms.has(`${prefix}.read.self`)
        if (!hasTier) additions.push(`${prefix}.read.${tier}`)
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
    `✔ record-visibility backfill — ${summary.granted} grants across ${summary.updated} role(s) (${summary.scanned} scanned)`,
  )
  await pg.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
