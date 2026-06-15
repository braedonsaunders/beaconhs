// One-off verification helper for the inline embedded-app sheet.
//
// Ensures an assessment has a TYPE, attaches a published form template to that
// type, and seeds a linked draft response — so the assessment's "Assessment
// apps" section renders and `?app=<typeAppId>&responseId=<id>` opens the
// full-screen FormRenderer sheet. Idempotent. Run with:
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env src/scripts/verify-embed.ts
//
// beaconhs_app owns the tables (RLS ENABLE, not FORCE) so the owner bypasses RLS.

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { and, desc, eq, isNull } from 'drizzle-orm'
import * as s from '../schema'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL required')
  const sql = postgres(url, { max: 1 })
  const db = drizzle(sql, { schema: s })
  try {
    // Tenant-scoped tables are FORCE RLS — bypass for this cross-tenant helper
    // (session-level on the single pooled connection).
    await sql`select set_config('app.bypass_rls', 'on', false)`
    const [asm] = await db
      .select({
        id: s.hazidAssessments.id,
        tenantId: s.hazidAssessments.tenantId,
        typeId: s.hazidAssessments.assessmentTypeId,
      })
      .from(s.hazidAssessments)
      .where(isNull(s.hazidAssessments.deletedAt))
      .orderBy(desc(s.hazidAssessments.createdAt))
      .limit(1)
    if (!asm) throw new Error('No assessments found')

    // Apps attach at the TYPE level — make sure this assessment has one.
    let typeId = asm.typeId
    if (!typeId) {
      const [existingType] = await db
        .select({ id: s.hazidAssessmentTypes.id })
        .from(s.hazidAssessmentTypes)
        .where(
          and(
            eq(s.hazidAssessmentTypes.tenantId, asm.tenantId),
            isNull(s.hazidAssessmentTypes.deletedAt),
          ),
        )
        .limit(1)
      typeId =
        existingType?.id ??
        (
          await db
            .insert(s.hazidAssessmentTypes)
            .values({ tenantId: asm.tenantId, name: 'Embed verify' })
            .returning({ id: s.hazidAssessmentTypes.id })
        )[0]!.id
      await db
        .update(s.hazidAssessments)
        .set({ assessmentTypeId: typeId })
        .where(eq(s.hazidAssessments.id, asm.id))
    }

    const published = await db
      .select({ id: s.formTemplates.id, name: s.formTemplates.name })
      .from(s.formTemplates)
      .where(eq(s.formTemplates.status, 'published'))
    if (published.length === 0) throw new Error('No published form template')
    const pick =
      published.find((t) => /confined/i.test(t.name)) ??
      published.find((t) => /arc flash/i.test(t.name)) ??
      published[0]!

    const [ver] = await db
      .select({ id: s.formTemplateVersions.id, version: s.formTemplateVersions.version })
      .from(s.formTemplateVersions)
      .where(eq(s.formTemplateVersions.templateId, pick.id))
      .orderBy(desc(s.formTemplateVersions.version))
      .limit(1)
    if (!ver) throw new Error('Picked template has no version')

    const key = 'embed_verify'
    await db
      .insert(s.hazidAssessmentTypeApps)
      .values({
        tenantId: asm.tenantId,
        typeId,
        templateId: pick.id,
        key,
        label: pick.name,
        required: false,
        autoCreate: false,
        entityOrder: 99,
      })
      .onConflictDoNothing()
    const [typeApp] = await db
      .select()
      .from(s.hazidAssessmentTypeApps)
      .where(
        and(eq(s.hazidAssessmentTypeApps.typeId, typeId), eq(s.hazidAssessmentTypeApps.key, key)),
      )
      .limit(1)
    if (!typeApp) throw new Error('typeApp upsert failed')

    let link = (
      await db
        .select({
          id: s.hazidAssessmentAppResponses.id,
          responseId: s.hazidAssessmentAppResponses.responseId,
        })
        .from(s.hazidAssessmentAppResponses)
        .where(
          and(
            eq(s.hazidAssessmentAppResponses.assessmentId, asm.id),
            eq(s.hazidAssessmentAppResponses.typeAppId, typeApp.id),
          ),
        )
        .limit(1)
    )[0]

    if (!link) {
      const [resp] = await db
        .insert(s.formResponses)
        .values({
          tenantId: asm.tenantId,
          templateId: pick.id,
          templateVersionId: ver.id,
          status: 'draft',
          submittedBy: null,
          data: {},
          sourceEntityType: 'hazid_assessment',
          sourceEntityId: asm.id,
        })
        .returning({ id: s.formResponses.id })
      const [l] = await db
        .insert(s.hazidAssessmentAppResponses)
        .values({
          tenantId: asm.tenantId,
          assessmentId: asm.id,
          typeAppId: typeApp.id,
          templateId: pick.id,
          responseId: resp!.id,
          entityOrder: 99,
        })
        .returning({
          id: s.hazidAssessmentAppResponses.id,
          responseId: s.hazidAssessmentAppResponses.responseId,
        })
      link = l!
    }

    console.log(
      JSON.stringify(
        {
          assessmentId: asm.id,
          typeAppId: typeApp.id,
          responseId: link.responseId,
          templateName: pick.name,
          assessmentUrl: `/hazard-assessments/${asm.id}#section-apps`,
          appUrl: `/hazard-assessments/${asm.id}?app=${typeApp.id}&responseId=${link.responseId}`,
        },
        null,
        2,
      ),
    )
  } finally {
    await sql.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
