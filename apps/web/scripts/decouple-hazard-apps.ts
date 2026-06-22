// Decouple the hazard-assessment Builder apps (Fall Protection / Confined Space /
// Arc Flash, etc.) from the hazard module: clear the vestigial
// module_binding='hazard_assessment_app' so they are plain Builder apps. Their
// OPTIONAL attachment to a hazard-assessment type lives in hazid_assessment_type_apps
// (the join + autoCreate), which is untouched and still drives in-assessment embedding.
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env ../web/scripts/decouple-hazard-apps.ts <tenant-uuid>
import { and, eq } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { formTemplates } from '@beaconhs/db/schema'

async function main() {
  const tenantId = process.argv[2]
  if (!tenantId) throw new Error('Pass a tenant UUID.')
  await withTenant(db, tenantId, async (tx) => {
    const updated = await tx
      .update(formTemplates)
      .set({ moduleBinding: null })
      .where(
        and(
          eq(formTemplates.tenantId, tenantId),
          eq(formTemplates.moduleBinding, 'hazard_assessment_app'),
        ),
      )
      .returning({ name: formTemplates.name, category: formTemplates.category })
    console.log(`Cleared module_binding on ${updated.length} app(s):`)
    for (const t of updated) console.log(`  - ${t.name} (category=${t.category})`)
  })
  process.exit(0)
}
main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
