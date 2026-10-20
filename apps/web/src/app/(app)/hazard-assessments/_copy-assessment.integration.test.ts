import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { and, eq, sql } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  tenants,
  formTemplates,
  formTemplateVersions,
  formResponses,
  hazidAssessments,
  hazidAssessmentTypes,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypeApps,
  hazidAssessmentAppResponses,
  hazidAssessmentHazards,
  hazidAssessmentTasks,
  hazidAssessmentPPE,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  people,
  pdfTemplates,
} from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { copyAssessmentInTransaction } from './_copy-assessment'
import type { HazidCtx } from './_assessment-rules'
import { loadHazidPdfAppendices } from '@/lib/hazid-pdf-apps'

const url = process.env.DATABASE_URL
const adminUrl = process.env.SUPERADMIN_DATABASE_URL
// This suite creates disposable fixtures; never allow a production connection.
for (const value of [url, adminUrl]) {
  if (!value || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname))
    throw new Error('HazID integration tests require an isolated localhost database')
}
const app = createClient({ url, max: 2 })
const admin = createClient({ url: adminUrl, max: 2 })
const tenantId = randomUUID(),
  otherTenant = randomUUID(),
  sourceId = randomUUID(),
  typeId = randomUUID(),
  templateId = randomUUID(),
  versionId = randomUUID(),
  typeAppId = randomUUID(),
  questionId = randomUUID(),
  workerId = randomUUID()
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  workflow: {
    steps: [{ key: 'submit', title: { en: 'Submit' }, assignee: { type: 'role', role: 'worker' } }],
  },
  title: { en: 'Fall Protection Plan' },
  sections: [
    {
      id: 'setup',
      title: { en: 'Plan' },
      fields: [
        { id: 'work_description', type: 'long_text', label: { en: 'Work description' } },
        { id: 'rescue', type: 'long_text', label: { en: 'Rescue plan' } },
        {
          id: 'work_date',
          type: 'date',
          label: { en: 'Work date' },
          defaultValue: { kind: 'today' },
        },
        { id: 'signature', type: 'signature', label: { en: 'Supervisor signature' } },
      ],
    },
  ],
}
const ctx: HazidCtx = {
  tenantId,
  userId: 'test',
  membership: null,
  personId: null,
  isSuperAdmin: true,
  permissions: new Set(['*']),
  scopes: [],
  timezone: 'America/Toronto',
  locale: 'en',
  defaultLocale: 'en',
  enabledLocales: ['en'],
  localeOverride: null,
  db: (run) => withTenant(app.db, tenantId, run),
}
beforeAll(async () => {
  await admin.db.insert(tenants).values([
    { id: tenantId, slug: tenantId, name: 'Copy test' },
    { id: otherTenant, slug: otherTenant, name: 'Other test' },
  ])
  await ctx.db(async (tx) => {
    await tx.insert(hazidAssessmentTypes).values({ id: typeId, tenantId, name: 'Daily JSA' })
    await tx
      .insert(hazidAssessmentTypeQuestions)
      .values({ id: questionId, tenantId, typeId, question: 'Work at heights?' })
    await tx.insert(formTemplates).values({
      id: templateId,
      tenantId,
      key: 'hazid-fall-protection-plan',
      name: 'Fall Protection Plan',
      status: 'published',
    })
    await tx
      .insert(formTemplateVersions)
      .values({ id: versionId, tenantId, templateId, version: 1, schema })
    await tx.insert(hazidAssessmentTypeApps).values([
      {
        id: typeAppId,
        tenantId,
        typeId,
        templateId,
        key: 'fall',
        label: 'Fall Protection Plan',
        config: { condition: { questionId, operator: 'equals', value: 'yes' } },
      },
      { tenantId, typeId, templateId, key: 'unstarted', label: 'Unstarted plan', entityOrder: 2 },
      {
        tenantId,
        typeId,
        templateId,
        key: 'not-applicable',
        label: 'Excluded plan',
        config: { condition: { questionId, operator: 'equals', value: 'no' } },
        entityOrder: 3,
      },
    ])
    await tx.insert(pdfTemplates).values({
      tenantId,
      key: 'fall-test',
      name: 'Fall plan PDF',
      recordSubjectType: 'form_template',
      recordSubjectKey: templateId,
      compiledHtml: '<h1>Fall Protection Plan</h1><p>{{work_description}}</p><p>{{rescue}}</p>',
      sourceHtml: '<p>Plan</p>',
      isActive: true,
      isModuleDefault: true,
    })
    await tx
      .insert(people)
      .values({ id: workerId, tenantId, firstName: 'Test', lastName: 'Worker' })
    await tx.insert(hazidAssessments).values({
      id: sourceId,
      tenantId,
      reference: 'JSA-SOURCE',
      occurredAt: new Date('2026-10-01T12:00:00Z'),
      assessmentTypeId: typeId,
      jobScope: '<p>Repair the platform</p>',
      locationOnSite: 'North platform',
      locked: false,
      inProgress: true,
      reviewStatus: 'approved',
      signingRevision: 2,
    })
    await tx.insert(hazidAssessmentHazards).values({
      tenantId,
      assessmentId: sourceId,
      name: 'Fall',
      specificControls: 'Anchor A',
      applicable: true,
      controls: 'Harness',
      preLikelihood: 4,
      preSeverity: 5,
      postLikelihood: 1,
      postSeverity: 5,
    })
    await tx.insert(hazidAssessmentTasks).values({
      tenantId,
      assessmentId: sourceId,
      description: 'Replace grating',
      controls: 'Barricade below',
    })
    await tx
      .insert(hazidAssessmentPPE)
      .values({ tenantId, assessmentId: sourceId, name: 'Harness', answer: 'yes' })
    await tx.insert(hazidAssessmentQuestions).values({
      tenantId,
      assessmentId: sourceId,
      sourceTypeQuestionId: questionId,
      question: 'Work at heights?',
      answer: 'yes',
    })
    await tx.insert(hazidAssessmentSignatures).values([
      {
        tenantId,
        assessmentId: sourceId,
        revision: 2,
        signatureType: 'internal',
        personId: workerId,
        signedAt: new Date(),
        requestedAt: new Date(),
        requestId: randomUUID(),
      },
      {
        tenantId,
        assessmentId: sourceId,
        revision: 2,
        signatureType: 'external',
        externalName: 'Visitor Example',
        signedAt: new Date(),
      },
    ])
    const [response] = await tx
      .insert(formResponses)
      .values({
        tenantId,
        templateId,
        templateVersionId: versionId,
        status: 'draft',
        sourceEntityType: 'hazid_assessment',
        sourceEntityId: sourceId,
        data: {
          work_description: 'Older saved description',
          rescue: 'Rescue by lift',
          work_date: '2026-10-01',
          signature: 'old-ink',
        },
        draftData: { values: { work_description: 'Current draft work description' }, rows: {} },
      })
      .returning({ id: formResponses.id })
    await tx
      .insert(hazidAssessmentAppResponses)
      .values({ tenantId, assessmentId: sourceId, typeAppId, templateId, responseId: response!.id })
    await tx
      .update(hazidAssessments)
      .set({ locked: true, inProgress: false, signingFrozenAt: new Date() })
      .where(eq(hazidAssessments.id, sourceId))
  })
})
afterAll(async () => {
  try {
    await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
    await admin.db.delete(tenants).where(eq(tenants.id, otherTenant))
  } finally {
    await app.sql.end()
    await admin.sql.end()
  }
})
it('preserves complete job content and linked draft answers while requiring fresh signatures and approvals', async () => {
  const copied = await ctx.db((tx) =>
    copyAssessmentInTransaction(tx, ctx, sourceId, false, {
      attachment: async (_tx, id) => id,
      payload: async (_tx, data) => data,
    }),
  )
  const copy = copied.copy
  expect(copy).toMatchObject({
    jobScope: '<p>Repair the platform</p>',
    locationOnSite: 'North platform',
    locked: false,
    inProgress: true,
    reviewStatus: 'pending',
    signingRevision: 1,
    signingFrozenAt: null,
  })
  expect(copy.reference).not.toBe('JSA-SOURCE')
  await ctx.db(async (tx) => {
    expect(
      await tx
        .select()
        .from(hazidAssessmentHazards)
        .where(eq(hazidAssessmentHazards.assessmentId, copy.id)),
    ).toMatchObject([
      { specificControls: 'Anchor A', controls: 'Harness', preLikelihood: 4, postLikelihood: 1 },
    ])
    expect(
      await tx
        .select()
        .from(hazidAssessmentTasks)
        .where(eq(hazidAssessmentTasks.assessmentId, copy.id)),
    ).toMatchObject([{ description: 'Replace grating', controls: 'Barricade below' }])
    expect(
      await tx
        .select()
        .from(hazidAssessmentPPE)
        .where(eq(hazidAssessmentPPE.assessmentId, copy.id)),
    ).toMatchObject([{ name: 'Harness', answer: 'yes' }])
    expect(
      await tx
        .select()
        .from(hazidAssessmentQuestions)
        .where(eq(hazidAssessmentQuestions.assessmentId, copy.id)),
    ).toMatchObject([{ sourceTypeQuestionId: questionId, answer: 'yes' }])
    const crew = await tx
      .select()
      .from(hazidAssessmentSignatures)
      .where(eq(hazidAssessmentSignatures.assessmentId, copy.id))
    expect(crew).toHaveLength(2)
    expect(
      crew.every(
        (member) =>
          !member.signedAt &&
          !member.signatureAttachmentId &&
          !member.requestId &&
          !member.requestedAt,
      ),
    ).toBe(true)
    const plans = await tx
      .select({ response: formResponses })
      .from(hazidAssessmentAppResponses)
      .innerJoin(formResponses, eq(formResponses.id, hazidAssessmentAppResponses.responseId))
      .where(
        and(
          eq(hazidAssessmentAppResponses.assessmentId, copy.id),
          eq(hazidAssessmentAppResponses.typeAppId, typeAppId),
        ),
      )
    expect(plans).toHaveLength(1)
    expect(plans[0]?.response).toMatchObject({
      status: 'draft',
      locked: false,
      workflowState: null,
      sourceEntityId: copy.id,
      data: { work_description: 'Current draft work description', rescue: 'Rescue by lift' },
    })
    expect(plans[0]?.response.data.signature).toBeUndefined()
    expect(plans[0]?.response.data.work_date).not.toBe('2026-10-01')
  })
  const hidden = await withTenant(app.db, otherTenant, (tx) =>
    tx.select().from(hazidAssessments).where(eq(hazidAssessments.id, copy.id)),
  )
  expect(hidden).toEqual([])
})
it('exports current draft plan content with a draft label, includes an unstarted notice, and excludes non-applicable plans', async () => {
  const parts = await loadHazidPdfAppendices(ctx, sourceId)
  expect(parts).toHaveLength(2)
  expect(parts[0]?.html).toContain('Current draft work description')
  expect(parts[0]?.html).toContain('Rescue by lift')
  expect(parts[0]?.html).toContain('DRAFT')
  expect(parts[0]?.html).not.toContain('Older saved description')
  expect(parts[1]?.html).toContain('NOT STARTED')
})

it('refuses an incomplete export when the caller cannot access an applicable attached plan', async () => {
  await ctx.db((tx) =>
    tx
      .update(formTemplates)
      .set({ allowedRoles: ['safety-only'] })
      .where(eq(formTemplates.id, templateId)),
  )
  try {
    await expect(
      loadHazidPdfAppendices(
        { ...ctx, isSuperAdmin: false, permissions: new Set(['hazid.read.all']) },
        sourceId,
      ),
    ).rejects.toThrow('current access')
  } finally {
    await ctx.db((tx) =>
      tx.update(formTemplates).set({ allowedRoles: null }).where(eq(formTemplates.id, templateId)),
    )
  }
})
it('includes submitted plan answers in the same export, without labelling the submitted plan as draft', async () => {
  await ctx.db(async (tx) => {
    await tx
      .update(hazidAssessments)
      .set({ locked: false })
      .where(eq(hazidAssessments.id, sourceId))
    const [link] = await tx
      .select()
      .from(hazidAssessmentAppResponses)
      .where(
        and(
          eq(hazidAssessmentAppResponses.assessmentId, sourceId),
          eq(hazidAssessmentAppResponses.typeAppId, typeAppId),
        ),
      )
    await tx
      .update(formResponses)
      .set({
        status: 'submitted',
        draftData: null,
        data: {
          work_description: 'Replace platform grating using anchor A',
          rescue: 'Lower worker using the rescue lift',
          work_date: '2026-10-20',
        },
      })
      .where(eq(formResponses.id, link!.responseId))
  })
  const parts = await loadHazidPdfAppendices(ctx, sourceId)
  expect(parts[0]?.html).toContain('Replace platform grating using anchor A')
  expect(parts[0]?.html).toContain('Lower worker using the rescue lift')
  expect(parts[0]?.html).not.toContain('DRAFT')
  if (process.env.BEACON_HAZID_REVIEW_DIR) {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { createHazidFlowAdapter } = await import('@/lib/flows/adapters/hazid')
    const { buildSubjectPdfJob } = await import('@/lib/flows/pdf-document')
    const { MODULE_PDF_TEMPLATE_SEEDS } = await import('@beaconhs/db/seed/pdf-templates')
    const { expandRepeatMarkers } = await import('@beaconhs/email-render')
    const adapter = createHazidFlowAdapter(ctx, sourceId)
    const seed = MODULE_PDF_TEMPLATE_SEEDS.find((item) => item.key === 'hazid-assessment-pdf')!
    const job = await buildSubjectPdfJob(adapter, await adapter.loadValues(), {
      tenantId,
      filename: 'assessment-with-fall-plan.pdf',
      template: {
        id: 'review-template',
        compiledHtml: expandRepeatMarkers(seed.html),
        paperSize: 'letter',
        orientation: 'portrait',
        marginMm: 14,
        headerHtml: null,
        footerHtml: '{{page}} / {{pages}}',
      },
    })
    await mkdir(process.env.BEACON_HAZID_REVIEW_DIR, { recursive: true })
    await writeFile(
      `${process.env.BEACON_HAZID_REVIEW_DIR}/bundle.json`,
      JSON.stringify(job, null, 2),
    )
  }
})

it('upgrades untouched JSA templates idempotently while preserving customized templates in another tenant', async () => {
  const { readFileSync } = await import('node:fs')
  const migration = readFileSync(
    new URL('../../../../../../packages/db/drizzle/0073_hazid_pdf_controls.sql', import.meta.url),
    'utf8',
  )
  const versions = [...migration.matchAll(/\$template\$([\s\S]*?)\$template\$/g)].map(
    (match) => match[1]!,
  )
  expect(versions).toHaveLength(4)
  const [nextSource, nextCompiled, oldSource, oldCompiled] = versions
  await ctx.db((tx) =>
    tx.insert(pdfTemplates).values({
      tenantId,
      key: 'hazid-assessment-pdf',
      name: 'Canonical JSA',
      recordSubjectType: 'module',
      recordSubjectKey: 'hazid',
      sourceHtml: oldSource!,
      compiledHtml: oldCompiled!,
      isModuleDefault: true,
    }),
  )
  const customized = oldSource!.replace('Hazard Assessment', 'Custom job safety document')
  await withTenant(app.db, otherTenant, (tx) =>
    tx.insert(pdfTemplates).values({
      tenantId: otherTenant,
      key: 'hazid-assessment-pdf',
      name: 'Customized JSA',
      recordSubjectType: 'module',
      recordSubjectKey: 'hazid',
      sourceHtml: customized,
      compiledHtml: oldCompiled!,
    }),
  )
  // Execute as the application role so FORCE RLS requires the migration's tenant contexts.
  await app.db.execute(sql.raw(migration))
  const load = () =>
    ctx.db(
      async (tx) =>
        (
          await tx.select().from(pdfTemplates).where(eq(pdfTemplates.key, 'hazid-assessment-pdf'))
        )[0]!,
    )
  const first = await load()
  expect(first.sourceHtml).toBe(nextSource)
  expect(first.compiledHtml).toBe(nextCompiled)
  await app.db.execute(sql.raw(migration))
  expect((await load()).updatedAt).toEqual(first.updatedAt)
  const [custom] = await withTenant(app.db, otherTenant, (tx) => tx.select().from(pdfTemplates))
  expect(custom?.sourceHtml).toBe(customized)
  expect(custom?.compiledHtml).toBe(oldCompiled)
})
