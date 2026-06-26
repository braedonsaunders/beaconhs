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
// Idempotent: a re-run finds the write keys already present and grants nothing.
// Never downgrades / removes anything.
//
//   DATABASE_URL='postgresql://…' npx tsx src/scripts/backfill-hazid-inspections-write.ts
//
// Roles are tenant-RLS'd; we read+write inside one bypass transaction so the
// owner connection sees every tenant (same GUC getRequestContext uses).

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
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
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL required')
  const pg = postgres(url, { max: 1 })
  const db = drizzle(pg, { schema: s })

  const summary = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const roles = await tx
      .select({ id: s.roles.id, key: s.roles.key, permissions: s.roles.permissions })
      .from(s.roles)

    let updated = 0
    let granted = 0
    for (const role of roles) {
      const perms = new Set<string>(role.permissions ?? [])
      const additions: string[] = []
      for (const prefix of MODULES) {
        if (!readsModule(perms, prefix)) continue
        for (const action of ['create', 'update'] as const) {
          const key = `${prefix}.${action}`
          if (!perms.has(key)) additions.push(key)
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
