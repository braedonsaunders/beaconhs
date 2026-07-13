// Ensure every tenant's built-in "Lift Plan" form matches the latest
// (exact-legacy) schema. Inserts it where missing; where present, publishes a
// new version carrying the latest schema (the filler serves MAX(version)).
//
// Idempotent: if a tenant's latest version already equals the current schema we
// skip — re-running does not pile up duplicate versions.
//
// Run with:
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../apps/web/.env.local src/scripts/reseed-lift-plan.ts
// (or point --env-file at whichever .env holds SUPERADMIN_DATABASE_URL).

import { and, desc, eq } from 'drizzle-orm'
import { createSuperClient } from '../client'
import * as s from '../schema'
import {
  LIFT_PLAN_TEMPLATE_CATEGORY,
  LIFT_PLAN_TEMPLATE_KEY,
  LIFT_PLAN_TEMPLATE_MODULE_BINDING,
  LIFT_PLAN_TEMPLATE_NAME,
  LIFT_PLAN_TEMPLATE_SCHEMA,
  seedLiftPlanTemplate,
} from '../seed/lift-plan-template'

async function main() {
  const { db, sql } = createSuperClient({ max: 1 })
  const target = JSON.stringify(LIFT_PLAN_TEMPLATE_SCHEMA)
  try {
    const tenants = await db.select({ id: s.tenants.id }).from(s.tenants)
    const out: unknown[] = []
    for (const t of tenants) {
      // Restore a soft-deleted built-in or insert a missing one without
      // overwriting an active tenant-customized version.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await seedLiftPlanTemplate(db as any, t.id)
      const [tmpl] = await db
        .select({ id: s.formTemplates.id })
        .from(s.formTemplates)
        .where(
          and(eq(s.formTemplates.tenantId, t.id), eq(s.formTemplates.key, LIFT_PLAN_TEMPLATE_KEY)),
        )
        .limit(1)

      if (!tmpl) throw new Error(`Lift Plan seed failed for tenant ${t.id}`)

      // Already up to date? Compare the latest version's schema and skip.
      const [latest] = await db
        .select({ version: s.formTemplateVersions.version, schema: s.formTemplateVersions.schema })
        .from(s.formTemplateVersions)
        .where(eq(s.formTemplateVersions.templateId, tmpl.id))
        .orderBy(desc(s.formTemplateVersions.version))
        .limit(1)
      if (latest && JSON.stringify(latest.schema) === target) {
        out.push({ tenantId: t.id, action: 'up-to-date', version: latest.version })
        continue
      }

      const nextVersion = (latest?.version ?? 0) + 1
      await db.insert(s.formTemplateVersions).values({
        tenantId: t.id,
        templateId: tmpl.id,
        version: nextVersion,
        schema: LIFT_PLAN_TEMPLATE_SCHEMA,
        publishedAt: new Date(),
        publishedBy: null,
        changelog: 'Recreate exact legacy Lift Plan form',
      })
      await db
        .update(s.formTemplates)
        .set({
          name: LIFT_PLAN_TEMPLATE_NAME,
          category: LIFT_PLAN_TEMPLATE_CATEGORY,
          moduleBinding: LIFT_PLAN_TEMPLATE_MODULE_BINDING,
          status: 'published',
        })
        .where(eq(s.formTemplates.id, tmpl.id))
      out.push({ tenantId: t.id, action: 'bumped', version: nextVersion })
    }
    console.log(JSON.stringify({ tenants: tenants.length, results: out }, null, 2))
  } finally {
    await sql.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
