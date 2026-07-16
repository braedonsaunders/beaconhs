'use server'

// All server actions used by the HazID detail page and its sub-sections.
// Keep these co-located so the detail page wiring is straightforward and the
// audit-log call is consistent.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import { assertCan, can, type RequestContext } from '@beaconhs/tenant'
import { htmlToText, sanitizeDocumentHtml } from '@beaconhs/forms-core'
import {
  attachments,
  formResponses,
  formTemplateVersions,
  formTemplates,
  hazidAssessmentAppResponses,
  hazidAssessmentHazards,
  hazidAssessmentPPE,
  hazidAssessmentPhotos,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessmentTypeApps,
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidAssessments,
  hazidHazards,
  hazidHazardSets,
  hazidHazardTypes,
  hazidLocationTasks,
  hazidTasks,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'
import { canSeeRecord } from '@/lib/visibility'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { moduleFlowCommand, recordDomainEvent, recordModuleFlowEvent } from '@beaconhs/events'
import { hazardAssessmentCreatedEvent } from '@beaconhs/integrations'
import { nextReference } from '@/lib/reference'
import { parseDatetimeLocal } from '@/lib/datetime'
import { isUuid } from '@/lib/list-params'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { canAccessTemplate, canEditResponsePayload } from '@/app/(app)/apps/_lib/access'
import { riskRating } from './_risk-scale'
import { hazidAppIsApplicable } from '@/lib/hazid-app-condition'

// All HazID server actions assume a tenant is active. requireRequestContext
// types tenantId as string | null because some admin pages run pre-tenant —
// but every page below /hazard-assessments is tenant-scoped, so we narrow once here.
type HazidCtx = Omit<RequestContext, 'tenantId'> & { tenantId: string }

async function ctxWithTenant(): Promise<HazidCtx> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('Active tenant required')
  return ctx as HazidCtx
}

// Re-scope guard for the per-assessment actions: the caller already holds
// `hazid.update`, but a self/site-tier user must not be able to drive an
// assessment they cannot see by guessing its id. Mirrors the detail page's
// canSeeRecord check (prefix 'hazid', owner = reporter, site). Soft-deleted
// assessments are treated as not found.
async function assertCanSeeAssessment(ctx: HazidCtx, assessmentId: string): Promise<void> {
  await resolveAssessmentAccess(ctx, assessmentId)
}

// Mutation guard: visibility re-scope PLUS lock enforcement. The detail page
// only hides controls when an assessment is locked, so the server must reject
// writes on a locked (signed) assessment regardless of what gets posted —
// otherwise signatures would silently stop attesting to what was signed.
// Lock/unlock/copy/delete/export keep the plain visibility guard.
async function assertAssessmentEditable(ctx: HazidCtx, assessmentId: string): Promise<void> {
  const row = await resolveAssessmentAccess(ctx, assessmentId)
  if (row.locked) throw new Error('This assessment is locked. Unlock it to make changes.')
}

async function resolveAssessmentAccess(
  ctx: HazidCtx,
  assessmentId: string,
): Promise<{ locked: boolean }> {
  const row = await ctx.db(async (tx) => {
    const [found] = await tx
      .select({
        reportedByTenantUserId: hazidAssessments.reportedByTenantUserId,
        siteOrgUnitId: hazidAssessments.siteOrgUnitId,
        locked: hazidAssessments.locked,
      })
      .from(hazidAssessments)
      .where(and(eq(hazidAssessments.id, assessmentId), isNull(hazidAssessments.deletedAt)))
      .limit(1)
    if (!found) return null
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'hazid',
      ownerIds: [found.reportedByTenantUserId],
      siteId: found.siteOrgUnitId,
    })
    return visible ? found : null
  })
  if (!row) throw new Error('Assessment not found')
  return { locked: row.locked }
}

const PATHS = (id: string) => [`/hazard-assessments/${id}`, '/hazard-assessments']

function revalidateAssessment(id: string) {
  for (const p of PATHS(id)) revalidatePath(p)
}

type HazidTx = any

async function lockVisibleAssessment(
  ctx: HazidCtx,
  tx: HazidTx,
  assessmentId: string,
): Promise<{ locked: boolean }> {
  const [row] = await tx
    .select({
      reportedByTenantUserId: hazidAssessments.reportedByTenantUserId,
      siteOrgUnitId: hazidAssessments.siteOrgUnitId,
      locked: hazidAssessments.locked,
    })
    .from(hazidAssessments)
    .where(
      and(
        eq(hazidAssessments.tenantId, ctx.tenantId),
        eq(hazidAssessments.id, assessmentId),
        isNull(hazidAssessments.deletedAt),
      ),
    )
    .limit(1)
    .for('update')
  if (!row) throw new Error('Assessment not found')
  const visible = await canSeeRecord(ctx, tx, {
    prefix: 'hazid',
    ownerIds: [row.reportedByTenantUserId],
    siteId: row.siteOrgUnitId,
  })
  if (!visible) throw new Error('Assessment not found')
  return { locked: row.locked }
}

async function lockEditableAssessment(
  ctx: HazidCtx,
  tx: HazidTx,
  assessmentId: string,
): Promise<void> {
  const row = await lockVisibleAssessment(ctx, tx, assessmentId)
  if (row.locked) throw new Error('This assessment is locked. Unlock it to make changes.')
}

async function setLinkedAssessmentAppsLocked(
  tx: HazidTx,
  args: {
    tenantId: string
    assessmentId: string
    locked: boolean
    lockedAt: Date | null
    lockedByTenantUserId: string | null
  },
): Promise<void> {
  // Embedded Builder responses are assessment content. Lock their rows in a
  // stable order before changing them so an already-open filler cannot alter
  // the signed assessment through the generic form-response write paths.
  const rows = await tx
    .select({ id: formResponses.id })
    .from(hazidAssessmentAppResponses)
    .innerJoin(
      formResponses,
      and(
        eq(formResponses.tenantId, hazidAssessmentAppResponses.tenantId),
        eq(formResponses.templateId, hazidAssessmentAppResponses.templateId),
        eq(formResponses.id, hazidAssessmentAppResponses.responseId),
      ),
    )
    .where(
      and(
        eq(hazidAssessmentAppResponses.tenantId, args.tenantId),
        eq(hazidAssessmentAppResponses.assessmentId, args.assessmentId),
        isNull(formResponses.deletedAt),
      ),
    )
    .orderBy(asc(formResponses.id))
    .for('update', { of: formResponses })
  const responseIds = rows.map((row: { id: string }) => row.id)
  if (responseIds.length === 0) return
  await tx
    .update(formResponses)
    .set({
      locked: args.locked,
      lockedAt: args.lockedAt,
      lockedByTenantUserId: args.lockedByTenantUserId,
    })
    .where(
      and(
        eq(formResponses.tenantId, args.tenantId),
        inArray(formResponses.id, responseIds),
        isNull(formResponses.deletedAt),
      ),
    )
}

async function latestTemplateVersion(tx: HazidTx, templateId: string) {
  const [version] = await tx
    .select({ id: formTemplateVersions.id })
    .from(formTemplateVersions)
    .where(eq(formTemplateVersions.templateId, templateId))
    .orderBy(desc(formTemplateVersions.version))
    .limit(1)
  return version ?? null
}

async function createAssessmentAppResponse(
  tx: HazidTx,
  args: {
    tenantId: string
    assessmentId: string
    typeAppId: string
    templateId: string
    entityOrder: number
    submittedBy?: string | null
  },
) {
  const version = await latestTemplateVersion(tx, args.templateId)
  if (!version) return null

  const [response] = await tx
    .insert(formResponses)
    .values({
      tenantId: args.tenantId,
      templateId: args.templateId,
      templateVersionId: version.id,
      status: 'draft',
      submittedBy: args.submittedBy ?? null,
      data: {},
      sourceEntityType: 'hazid_assessment',
      sourceEntityId: args.assessmentId,
    })
    .returning({ id: formResponses.id })
  if (!response) return null

  const [link] = await tx
    .insert(hazidAssessmentAppResponses)
    .values({
      tenantId: args.tenantId,
      assessmentId: args.assessmentId,
      typeAppId: args.typeAppId,
      templateId: args.templateId,
      responseId: response.id,
      entityOrder: args.entityOrder,
    })
    .returning()
  return link ?? null
}

async function createAutoAssessmentApps(
  tx: HazidTx,
  args: {
    ctx: HazidCtx
    tenantId: string
    assessmentId: string
    assessmentTypeId: string | null
    submittedBy?: string | null
  },
) {
  if (!args.assessmentTypeId) return []
  const roleKeys = await getEffectiveRoleKeys(args.ctx, tx)
  type AutoAssessmentAppRow = {
    app: typeof hazidAssessmentTypeApps.$inferSelect
    templateStatus: typeof formTemplates.$inferSelect.status
    templateAllowedRoles: typeof formTemplates.$inferSelect.allowedRoles
    templateDeletedAt: typeof formTemplates.$inferSelect.deletedAt
  }
  const rows: AutoAssessmentAppRow[] = await tx
    .select({
      app: hazidAssessmentTypeApps,
      templateStatus: formTemplates.status,
      templateAllowedRoles: formTemplates.allowedRoles,
      templateDeletedAt: formTemplates.deletedAt,
    })
    .from(hazidAssessmentTypeApps)
    .innerJoin(formTemplates, eq(formTemplates.id, hazidAssessmentTypeApps.templateId))
    .where(
      and(
        eq(hazidAssessmentTypeApps.typeId, args.assessmentTypeId),
        eq(hazidAssessmentTypeApps.autoCreate, true),
        isNull(hazidAssessmentTypeApps.deletedAt),
      ),
    )
    .orderBy(asc(hazidAssessmentTypeApps.entityOrder))
  const [questionRows, existingRows] = await Promise.all([
    tx
      .select({
        sourceTypeQuestionId: hazidAssessmentQuestions.sourceTypeQuestionId,
        answer: hazidAssessmentQuestions.answer,
      })
      .from(hazidAssessmentQuestions)
      .where(eq(hazidAssessmentQuestions.assessmentId, args.assessmentId)),
    tx
      .select({ typeAppId: hazidAssessmentAppResponses.typeAppId })
      .from(hazidAssessmentAppResponses)
      .where(eq(hazidAssessmentAppResponses.assessmentId, args.assessmentId)),
  ])
  const answers = new Map<string, string | null>(
    questionRows.flatMap((row: { sourceTypeQuestionId: string | null; answer: string | null }) =>
      row.sourceTypeQuestionId ? [[row.sourceTypeQuestionId, row.answer] as const] : [],
    ),
  )
  const existingTypeAppIds = new Set(
    existingRows.flatMap((row: { typeAppId: string | null }) =>
      row.typeAppId ? [row.typeAppId] : [],
    ),
  )
  const apps = rows.filter(
    (row) =>
      !existingTypeAppIds.has(row.app.id) &&
      hazidAppIsApplicable(row.app.config, answers) &&
      canAccessTemplate(
        args.ctx,
        {
          status: row.templateStatus,
          allowedRoles: row.templateAllowedRoles,
          deletedAt: row.templateDeletedAt,
        },
        roleKeys,
        'operate',
      ),
  )

  const links = []
  for (const { app } of apps) {
    const link = await createAssessmentAppResponse(tx, {
      tenantId: args.tenantId,
      assessmentId: args.assessmentId,
      typeAppId: app.id,
      templateId: app.templateId,
      entityOrder: app.entityOrder,
      submittedBy: args.submittedBy,
    })
    if (link) links.push(link)
  }
  return links
}

// ------------------------------------------------------------------
// Assessment CRUD
// ------------------------------------------------------------------

async function createAssessment(formData: FormData): Promise<{ id: string }> {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.create')
  const assessmentTypeId = String(formData.get('assessmentTypeId') ?? '').trim() || null
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const projectOrgUnitId = String(formData.get('projectOrgUnitId') ?? '').trim() || null
  const locationOnSite = String(formData.get('locationOnSite') ?? '').trim() || null
  const occurredAtRaw = String(formData.get('occurredAt') ?? '')
  const supervisorPersonId = String(formData.get('supervisorPersonId') ?? '').trim() || null
  // jobScope is rich-text HTML; sanitize it and treat an empty editor
  // (`<p></p>`) as null.
  const jobScope = nullableRichText(formData.get('jobScope'))
  const copyFromId = String(formData.get('copyFromId') ?? '').trim() || null

  // datetime-local values are wall-clock strings — parse them in the user's
  // timezone, not the server's.
  const occurredAt = occurredAtRaw ? parseDatetimeLocal(occurredAtRaw, ctx.timezone) : new Date()
  if (!occurredAt) throw new Error('Invalid occurred date/time')

  // Re-scope the copy source: a self/site-tier user must not be able to
  // exfiltrate an assessment they cannot see by replaying its id.
  if (copyFromId) await assertCanSeeAssessment(ctx, copyFromId)

  const created = await ctx.db(async (tx) => {
    if (copyFromId) await lockVisibleAssessment(ctx, tx, copyFromId)
    const reference = await nextReference(tx, ctx.tenantId, 'hazid')

    const [row] = await tx
      .insert(hazidAssessments)
      .values({
        tenantId: ctx.tenantId,
        reference,
        occurredAt,
        siteOrgUnitId,
        projectOrgUnitId,
        locationOnSite,
        supervisorPersonId,
        supervisorTenantUserId: null,
        reportedByTenantUserId: ctx.membership?.id ?? null,
        assessmentTypeId,
        jobScope,
        inProgress: true,
      })
      .returning()
    if (!row) throw new Error('Failed to create assessment')

    // Optionally seed from the assessment-type defaults.
    if (assessmentTypeId) {
      const [type] = await tx
        .select()
        .from(hazidAssessmentTypes)
        .where(eq(hazidAssessmentTypes.id, assessmentTypeId))
        .limit(1)
      if (type) {
        // Default PPE
        if (type.hasPPE) {
          const typePPE = await tx
            .select()
            .from(hazidAssessmentTypePPE)
            .where(eq(hazidAssessmentTypePPE.typeId, type.id))
            .orderBy(asc(hazidAssessmentTypePPE.entityOrder))
          if (typePPE.length > 0) {
            await tx.insert(hazidAssessmentPPE).values(
              typePPE.map((p) => ({
                tenantId: ctx.tenantId,
                assessmentId: row.id,
                name: p.name,
                description: p.description,
                required: p.required,
                entityOrder: p.entityOrder,
              })),
            )
          }
        }
        // Default questions
        if (type.hasQuestions) {
          const typeQ = await tx
            .select()
            .from(hazidAssessmentTypeQuestions)
            .where(eq(hazidAssessmentTypeQuestions.typeId, type.id))
            .orderBy(asc(hazidAssessmentTypeQuestions.entityOrder))
          if (typeQ.length > 0) {
            await tx.insert(hazidAssessmentQuestions).values(
              typeQ.map((q) => ({
                tenantId: ctx.tenantId,
                assessmentId: row.id,
                sourceTypeQuestionId: q.id,
                question: q.question,
                questionType: q.questionType,
                answers: q.answers,
                requiresYes: q.requiresYes,
                entityOrder: q.entityOrder,
              })),
            )
          }
        }
        // Default hazards from the type's default hazard set
        if (type.style === 'hazard_based' && type.defaultHazardSetId) {
          const [set] = await tx
            .select()
            .from(hazidHazardSets)
            .where(eq(hazidHazardSets.id, type.defaultHazardSetId))
            .limit(1)
          if (set && set.hazardIds.length > 0) {
            const hazRows = await tx
              .select()
              .from(hazidHazards)
              .where(
                and(
                  sql`${hazidHazards.id} = ANY(${set.hazardIds})`,
                  isNull(hazidHazards.deletedAt),
                ),
              )
            if (hazRows.length > 0) {
              await tx.insert(hazidAssessmentHazards).values(
                hazRows.map((h, i) => ({
                  tenantId: ctx.tenantId,
                  assessmentId: row.id,
                  hazardId: h.id,
                  standardControls: h.standardControls,
                  entityOrder: i + 1,
                })),
              )
            }
          }
        }
        // Location task suggestions
        if (type.style === 'task_based' && siteOrgUnitId) {
          const locTasks = await tx
            .select({ task: hazidTasks })
            .from(hazidLocationTasks)
            .innerJoin(hazidTasks, eq(hazidTasks.id, hazidLocationTasks.taskId))
            .where(eq(hazidLocationTasks.orgUnitId, siteOrgUnitId))
          if (locTasks.length > 0) {
            await tx.insert(hazidAssessmentTasks).values(
              locTasks.map((row2, i) => ({
                tenantId: ctx.tenantId,
                assessmentId: row.id,
                taskId: row2.task.id,
                hazardIds: row2.task.hazardIds,
                controls: row2.task.controls,
                entityOrder: i + 1,
              })),
            )
          }
        }
      }
    }

    // Optionally copy from an existing assessment.
    if (copyFromId) {
      const [src] = await tx
        .select()
        .from(hazidAssessments)
        .where(eq(hazidAssessments.id, copyFromId))
        .limit(1)
      if (src) {
        await tx
          .update(hazidAssessments)
          .set({
            // Re-sanitize on copy so payloads stored before write-time
            // sanitization existed cannot propagate into new records.
            jobScope: src.jobScope ? sanitizeDocumentHtml(src.jobScope) : null,
            locationOnSite: src.locationOnSite,
          })
          .where(eq(hazidAssessments.id, row.id))

        // Copy children (tasks, hazards, ppe, questions). Skip signatures
        // and photos.
        const srcTasks = await tx
          .select()
          .from(hazidAssessmentTasks)
          .where(eq(hazidAssessmentTasks.assessmentId, src.id))
        if (srcTasks.length > 0) {
          await tx.delete(hazidAssessmentTasks).where(eq(hazidAssessmentTasks.assessmentId, row.id))
          await tx.insert(hazidAssessmentTasks).values(
            srcTasks.map((t) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              taskId: t.taskId,
              description: t.description,
              hazardIds: t.hazardIds,
              controls: t.controls,
              entityOrder: t.entityOrder,
            })),
          )
        }
        const srcHaz = await tx
          .select()
          .from(hazidAssessmentHazards)
          .where(eq(hazidAssessmentHazards.assessmentId, src.id))
        if (srcHaz.length > 0) {
          await tx
            .delete(hazidAssessmentHazards)
            .where(eq(hazidAssessmentHazards.assessmentId, row.id))
          await tx.insert(hazidAssessmentHazards).values(
            srcHaz.map((h) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              hazardId: h.hazardId,
              name: h.name,
              standardControls: h.standardControls,
              specificControls: h.specificControls,
              applicable: h.applicable,
              entityOrder: h.entityOrder,
            })),
          )
        }
        const srcPPE = await tx
          .select()
          .from(hazidAssessmentPPE)
          .where(eq(hazidAssessmentPPE.assessmentId, src.id))
        if (srcPPE.length > 0) {
          await tx.delete(hazidAssessmentPPE).where(eq(hazidAssessmentPPE.assessmentId, row.id))
          await tx.insert(hazidAssessmentPPE).values(
            srcPPE.map((p) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              name: p.name,
              description: p.description,
              required: p.required,
              entityOrder: p.entityOrder,
            })),
          )
        }
        const srcQ = await tx
          .select()
          .from(hazidAssessmentQuestions)
          .where(eq(hazidAssessmentQuestions.assessmentId, src.id))
        if (srcQ.length > 0) {
          await tx
            .delete(hazidAssessmentQuestions)
            .where(eq(hazidAssessmentQuestions.assessmentId, row.id))
          await tx.insert(hazidAssessmentQuestions).values(
            srcQ.map((q) => ({
              tenantId: ctx.tenantId,
              assessmentId: row.id,
              sourceTypeQuestionId: q.sourceTypeQuestionId,
              question: q.question,
              questionType: q.questionType,
              answers: q.answers,
              requiresYes: q.requiresYes,
              entityOrder: q.entityOrder,
            })),
          )
        }
      }
    }

    await createAutoAssessmentApps(tx, {
      ctx,
      tenantId: ctx.tenantId,
      assessmentId: row.id,
      assessmentTypeId,
      submittedBy: ctx.membership?.id ?? null,
    })

    // Legacy parity: pre-seed an unsigned internal signature row for the
    // author so the sign-off list starts with the person who wrote the
    // assessment (they still sign on the Signatures tab).
    const [authorPerson] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1)
    if (authorPerson) {
      await tx.insert(hazidAssessmentSignatures).values({
        tenantId: ctx.tenantId,
        assessmentId: row.id,
        signatureType: 'internal',
        personId: authorPerson.id,
      })
    }

    await recordDomainEvent(tx, {
      tenantId: ctx.tenantId,
      eventType: 'hazard_assessment.created',
      subjectId: row.id,
      dedupKey: `hazard_assessment.created:${row.id}`,
      payload: {
        integration: hazardAssessmentCreatedEvent(ctx.tenantId, {
          id: row.id,
          reference: row.reference,
          status: 'in_progress',
          occurredAt: row.occurredAt,
          locationOnSite: row.locationOnSite,
        }),
        web: moduleFlowCommand(ctx, {
          subjectId: row.id,
          moduleKey: 'hazid',
          event: 'on_create',
        }),
      },
    })

    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: row.id,
      action: 'create',
      summary: `Created ${row.reference}`,
      after: { reference: row.reference, assessmentTypeId, siteOrgUnitId },
    })

    return row
  })
  revalidatePath('/hazard-assessments')
  return { id: created.id }
}

/**
 * Create a draft assessment from the list flyout (type only) and jump straight
 * to its detail page. The type seeds PPE/questions/default hazards/site tasks;
 * everything else — site, project, supervisor, job scope, location — is captured
 * inline on the detail page's live General-information section.
 */
export async function startAssessment(formData: FormData) {
  const assessmentTypeId = String(formData.get('assessmentTypeId') ?? '').trim()
  if (!assessmentTypeId) throw new Error('Assessment type is required')
  const { id } = await createAssessment(formData)
  redirect(`/hazard-assessments/${id}`)
}

export async function openAssessmentApp(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const typeAppId = String(formData.get('typeAppId') ?? '')
  if (!isUuid(assessmentId) || !isUuid(typeAppId)) throw new Error('Invalid assessment app')
  await assertCanSeeAssessment(ctx, assessmentId)

  const target = await ctx.db(async (tx) => {
    const lockedAssessment = await lockVisibleAssessment(ctx, tx, assessmentId)
    const [assessment] = await tx
      .select({
        id: hazidAssessments.id,
        assessmentTypeId: hazidAssessments.assessmentTypeId,
      })
      .from(hazidAssessments)
      .where(and(eq(hazidAssessments.id, assessmentId), isNull(hazidAssessments.deletedAt)))
      .limit(1)
    if (!assessment) throw new Error('Assessment not found')
    if (!assessment.assessmentTypeId) throw new Error('This assessment has no type')

    const [typeApp] = await tx
      .select({
        app: hazidAssessmentTypeApps,
        templateName: formTemplates.name,
        templateStatus: formTemplates.status,
        templateAllowedRoles: formTemplates.allowedRoles,
        templateDeletedAt: formTemplates.deletedAt,
      })
      .from(hazidAssessmentTypeApps)
      .innerJoin(formTemplates, eq(formTemplates.id, hazidAssessmentTypeApps.templateId))
      .where(
        and(
          eq(hazidAssessmentTypeApps.id, typeAppId),
          eq(hazidAssessmentTypeApps.typeId, assessment.assessmentTypeId),
          isNull(hazidAssessmentTypeApps.deletedAt),
        ),
      )
      .limit(1)
    if (!typeApp) throw new Error('Assessment app is not available for this type')

    const conditionalAnswers = await tx
      .select({
        sourceTypeQuestionId: hazidAssessmentQuestions.sourceTypeQuestionId,
        answer: hazidAssessmentQuestions.answer,
      })
      .from(hazidAssessmentQuestions)
      .where(eq(hazidAssessmentQuestions.assessmentId, assessmentId))
    const answersByTypeQuestionId = new Map(
      conditionalAnswers.flatMap((row) =>
        row.sourceTypeQuestionId ? [[row.sourceTypeQuestionId, row.answer] as const] : [],
      ),
    )
    if (!hazidAppIsApplicable(typeApp.app.config, answersByTypeQuestionId)) {
      throw new Error('Answer the configured assessment question before opening this app')
    }

    const roleKeys = await getEffectiveRoleKeys(ctx, tx)
    const templateAccess = {
      status: typeApp.templateStatus,
      allowedRoles: typeApp.templateAllowedRoles,
      deletedAt: typeApp.templateDeletedAt,
    }
    if (!canAccessTemplate(ctx, templateAccess, roleKeys, 'browse-records')) {
      throw new Error('Assessment app is not available for your active role')
    }

    const [existing] = await tx
      .select({
        link: hazidAssessmentAppResponses,
        response: formResponses,
      })
      .from(hazidAssessmentAppResponses)
      .innerJoin(formResponses, eq(formResponses.id, hazidAssessmentAppResponses.responseId))
      .where(
        and(
          eq(hazidAssessmentAppResponses.assessmentId, assessmentId),
          eq(hazidAssessmentAppResponses.typeAppId, typeAppId),
        ),
      )
      .limit(1)

    let responseId = existing?.response.id ?? null
    let status = existing?.response.status ?? null
    const preSubmit = status === 'draft' || status === 'in_progress'
    if (
      existing &&
      preSubmit &&
      (!canAccessTemplate(ctx, templateAccess, roleKeys, 'operate') ||
        !canEditResponsePayload(ctx, existing.response))
    ) {
      throw new Error('You do not have permission to continue this assessment app')
    }
    // Locked assessments are read-only: submitted responses stay viewable, but
    // pre-submit drafts must not be editable and new responses cannot start.
    if (lockedAssessment.locked && existing && (status === 'draft' || status === 'in_progress')) {
      throw new Error('Unlock this assessment before editing this app')
    }
    if (!responseId) {
      if (lockedAssessment.locked) {
        throw new Error('Unlock this assessment before starting a new app')
      }
      if (
        !can(ctx, 'forms.response.create') ||
        !canAccessTemplate(ctx, templateAccess, roleKeys, 'operate')
      ) {
        throw new Error('You do not have permission to start this assessment app')
      }
      const link = await createAssessmentAppResponse(tx, {
        tenantId: ctx.tenantId,
        assessmentId,
        typeAppId,
        templateId: typeApp.app.templateId,
        entityOrder: typeApp.app.entityOrder,
        submittedBy: ctx.membership?.id ?? null,
      })
      if (!link) throw new Error('No published app version found')
      responseId = link.responseId
      status = 'draft'
    }

    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: `Opened embedded app "${typeApp.templateName}"`,
      metadata: { responseId, templateId: typeApp.app.templateId },
    })

    return {
      responseId,
      status,
    }
  })

  revalidateAssessment(assessmentId)
  const preSubmit = target.status === 'draft' || target.status === 'in_progress'
  if (preSubmit) {
    // Open the app inline as a full-screen sheet over the assessment (the
    // `?app=` param the detail page renders) instead of navigating away to the
    // standalone fill page. The worker never leaves the assessment.
    redirect(
      `/hazard-assessments/${assessmentId}?app=${typeAppId}&responseId=${target.responseId}#section-apps` as any,
    )
  }
  redirect(`/apps/responses/${target.responseId}` as any)
}

export async function updateTextField(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const value = nullable(formData.get('value'))
  if (!id || !field) throw new Error('Missing id/field')
  await assertAssessmentEditable(ctx, id)
  const ALLOWED = new Set([
    'jobScope',
    // General-info fields editable inline on the single-page form
    'locationOnSite',
    'siteOrgUnitId',
    'projectOrgUnitId',
    'supervisorPersonId',
    'occurredAt',
    'assessmentTypeId',
  ])
  if (!ALLOWED.has(field)) throw new Error('Field not allowed')

  // Nullable FK columns — empty string clears them.
  const NULLABLE_IDS = new Set([
    'siteOrgUnitId',
    'projectOrgUnitId',
    'supervisorPersonId',
    'assessmentTypeId',
  ])
  const DATES = new Set(['occurredAt'])

  // Rich-text columns store HTML; sanitize on write and store an empty editor
  // (`<p></p>`) as null.
  const RICH = new Set(['jobScope'])

  let val: unknown = value
  if (RICH.has(field)) val = nullableRichText(value)
  if (NULLABLE_IDS.has(field)) val = value || null
  if (DATES.has(field)) {
    // datetime-local wall-clock strings are parsed in the user's timezone.
    const d = value ? parseDatetimeLocal(value, ctx.timezone) : null
    if (!d) throw new Error('Invalid date')
    val = d
  }

  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, id)
    const updates: Record<string, unknown> = { [field]: val }
    await tx
      .update(hazidAssessments)
      .set(updates as any)
      .where(eq(hazidAssessments.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: id,
      action: 'update',
      summary: `Updated ${field}`,
      after: { [field]: val },
    })
  })
  revalidateAssessment(id)
}

export async function lockAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  await assertCanSeeAssessment(ctx, id)
  await ctx.db(async (tx) => {
    const assessment = await lockVisibleAssessment(ctx, tx, id)
    if (assessment.locked) throw new Error('This assessment is already locked')
    const lockedAt = new Date()
    const lockedByTenantUserId = ctx.membership?.id ?? null
    await tx
      .update(hazidAssessments)
      .set({
        locked: true,
        inProgress: false,
        lockedAt,
        lockedByTenantUserId,
      })
      .where(eq(hazidAssessments.id, id))
    await setLinkedAssessmentAppsLocked(tx, {
      tenantId: ctx.tenantId,
      assessmentId: id,
      locked: true,
      lockedAt,
      lockedByTenantUserId,
    })
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: id,
      moduleKey: 'hazid',
      event: 'on_lock',
      occurrenceKey: randomUUID(),
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: id,
      action: 'update',
      summary: 'Locked',
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'hazard_assessment',
      targetRef: {},
    })
  })
  revalidateAssessment(id)
}

export async function reviewAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const note = String(formData.get('note') ?? '').trim() || null
  if (!isUuid(id) || (decision !== 'approved' && decision !== 'rejected')) {
    throw new Error('Choose approve or reject')
  }
  await assertCanSeeAssessment(ctx, id)
  await ctx.db(async (tx) => {
    await lockVisibleAssessment(ctx, tx, id)
    const reviewedAt = new Date()
    await tx
      .update(hazidAssessments)
      .set({
        reviewStatus: decision,
        reviewedAt,
        reviewedByTenantUserId: ctx.membership?.id ?? null,
        reviewNote: note,
      })
      .where(eq(hazidAssessments.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: id,
      action: 'update',
      summary: decision === 'approved' ? 'Safety review approved' : 'Safety review rejected',
      after: { decision, note, reviewedAt: reviewedAt.toISOString() },
    })
  })
  revalidateAssessment(id)
}

export async function unlockAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  await assertCanSeeAssessment(ctx, id)
  await ctx.db(async (tx) => {
    const assessment = await lockVisibleAssessment(ctx, tx, id)
    if (!assessment.locked) throw new Error('This assessment is not locked')
    await tx
      .update(hazidAssessments)
      .set({
        locked: false,
        inProgress: true,
        lockedAt: null,
        lockedByTenantUserId: null,
      })
      .where(eq(hazidAssessments.id, id))
    await setLinkedAssessmentAppsLocked(tx, {
      tenantId: ctx.tenantId,
      assessmentId: id,
      locked: false,
      lockedAt: null,
      lockedByTenantUserId: null,
    })
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: id,
      moduleKey: 'hazid',
      event: 'on_unlock',
      occurrenceKey: randomUUID(),
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: id,
      action: 'update',
      summary: 'Unlocked',
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'hazard_assessment',
      targetRef: {},
    })
  })
  revalidateAssessment(id)
}

export async function deleteAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  // Delete is a module-manager action — `hazid.update` alone is not enough.
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  await assertCanSeeAssessment(ctx, id)
  await ctx.db(async (tx) => {
    await lockVisibleAssessment(ctx, tx, id)
    await tx
      .update(hazidAssessments)
      .set({ deletedAt: new Date() })
      .where(eq(hazidAssessments.id, id))
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: id,
      moduleKey: 'hazid',
      event: 'on_delete',
      occurrenceKey: randomUUID(),
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: id,
      action: 'delete',
      summary: 'Soft-deleted assessment',
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'hazard_assessment',
      targetRef: {},
    })
  })
  revalidatePath('/hazard-assessments')
  // Deleting from the detail page would otherwise reload into a 404.
  redirect('/hazard-assessments')
}

// Duplicate an existing assessment as a fresh draft. Common workflow when the
// next job is similar to the previous one — copy the prior assessment, rename,
// tweak. We copy:
//   • the assessment row (new id, new reference, fresh occurred_at = now,
//     unlocked, job-scope suffixed with "(copy)" if non-empty)
//   • all hazards (with their pre/post risk ratings + controls)
//   • all tasks
//   • all PPE rows (without the user's prior yes/no/na answers)
//   • all questions (without the user's prior answer)
// We deliberately do NOT copy:
//   • signatures (every assessment needs its own sign-off)
//   • photos / file attachments (those are job-specific evidence)
//   • CS atmospheric readings / entry log (job-specific data points)
//   • signed-report bundles (different lifecycle)
// After the copy we redirect to the new detail page.
export async function copyAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.create')
  const sourceId = String(formData.get('id') ?? '')
  if (!sourceId) throw new Error('Missing id')
  // Re-scope the source: a self/site-tier user must be able to see the
  // assessment they are copying from.
  await assertCanSeeAssessment(ctx, sourceId)

  const created = await ctx.db(async (tx) => {
    await lockVisibleAssessment(ctx, tx, sourceId)
    const [src] = await tx
      .select()
      .from(hazidAssessments)
      .where(eq(hazidAssessments.id, sourceId))
      .limit(1)
    if (!src) throw new Error('Source assessment not found')

    // Reuse the same numbering scheme as createAssessment so references stay
    // consistent: HAZ-<year>-<counter>.
    const reference = await nextReference(tx, ctx.tenantId, 'hazid')

    const jobScope = src.jobScope ? `${src.jobScope} (copy)` : '(copy)'

    const [row] = await tx
      .insert(hazidAssessments)
      .values({
        tenantId: ctx.tenantId,
        reference,
        occurredAt: new Date(),
        siteOrgUnitId: src.siteOrgUnitId,
        projectOrgUnitId: src.projectOrgUnitId,
        locationOnSite: src.locationOnSite,
        supervisorPersonId: src.supervisorPersonId,
        supervisorTenantUserId: src.supervisorTenantUserId,
        reportedByTenantUserId: ctx.membership?.id ?? null,
        assessmentTypeId: src.assessmentTypeId,
        jobScope,
        // Lock state — always start as draft / in-progress.
        inProgress: true,
        locked: false,
      })
      .returning()
    if (!row) throw new Error('Failed to insert copied assessment')

    // Hazards — include pre/post risk ratings + controls.
    const srcHazards = await tx
      .select()
      .from(hazidAssessmentHazards)
      .where(eq(hazidAssessmentHazards.assessmentId, src.id))
      .orderBy(asc(hazidAssessmentHazards.entityOrder))
    if (srcHazards.length > 0) {
      await tx.insert(hazidAssessmentHazards).values(
        srcHazards.map((h) => ({
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          hazardId: h.hazardId,
          name: h.name,
          standardControls: h.standardControls,
          specificControls: h.specificControls,
          applicable: h.applicable,
          entityOrder: h.entityOrder,
          preLikelihood: h.preLikelihood,
          preSeverity: h.preSeverity,
          controls: h.controls,
          postLikelihood: h.postLikelihood,
          postSeverity: h.postSeverity,
        })),
      )
    }

    // Tasks
    const srcTasks = await tx
      .select()
      .from(hazidAssessmentTasks)
      .where(eq(hazidAssessmentTasks.assessmentId, src.id))
      .orderBy(asc(hazidAssessmentTasks.entityOrder))
    if (srcTasks.length > 0) {
      await tx.insert(hazidAssessmentTasks).values(
        srcTasks.map((t) => ({
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          taskId: t.taskId,
          description: t.description,
          hazardIds: t.hazardIds,
          controls: t.controls,
          entityOrder: t.entityOrder,
        })),
      )
    }

    // PPE — clear any prior yes/no/na answers; the new job re-answers.
    const srcPPE = await tx
      .select()
      .from(hazidAssessmentPPE)
      .where(eq(hazidAssessmentPPE.assessmentId, src.id))
      .orderBy(asc(hazidAssessmentPPE.entityOrder))
    if (srcPPE.length > 0) {
      await tx.insert(hazidAssessmentPPE).values(
        srcPPE.map((p) => ({
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          name: p.name,
          description: p.description,
          required: p.required,
          entityOrder: p.entityOrder,
          answer: null,
        })),
      )
    }

    // Questions — clear any prior text answers.
    const srcQ = await tx
      .select()
      .from(hazidAssessmentQuestions)
      .where(eq(hazidAssessmentQuestions.assessmentId, src.id))
      .orderBy(asc(hazidAssessmentQuestions.entityOrder))
    if (srcQ.length > 0) {
      await tx.insert(hazidAssessmentQuestions).values(
        srcQ.map((q) => ({
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          sourceTypeQuestionId: q.sourceTypeQuestionId,
          question: q.question,
          questionType: q.questionType,
          answers: q.answers,
          requiresYes: q.requiresYes,
          entityOrder: q.entityOrder,
          answer: null,
        })),
      )
    }

    await createAutoAssessmentApps(tx, {
      ctx,
      tenantId: ctx.tenantId,
      assessmentId: row.id,
      assessmentTypeId: src.assessmentTypeId,
      submittedBy: ctx.membership?.id ?? null,
    })

    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: row.id,
      action: 'copy',
      summary: `Copied from ${src.reference} as ${row.reference}`,
      after: { copiedFrom: src.id, copiedFromReference: src.reference },
    })

    return row
  })

  revalidatePath('/hazard-assessments')
  revalidatePath(`/hazard-assessments/${created.id}`)
  redirect(`/hazard-assessments/${created.id}` as any)
}

// ------------------------------------------------------------------
// Tasks
// ------------------------------------------------------------------
export async function addTask(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const taskId = String(formData.get('taskId') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null
  const controls = String(formData.get('controls') ?? '').trim() || null
  if (!assessmentId) throw new Error('Missing assessmentId')
  await assertAssessmentEditable(ctx, assessmentId)

  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    let hazardIds: string[] = []
    let nextControls = controls
    let nextDescription = description
    if (taskId) {
      const [t] = await tx.select().from(hazidTasks).where(eq(hazidTasks.id, taskId)).limit(1)
      if (t) {
        hazardIds = t.hazardIds
        if (!nextControls) nextControls = t.controls
        if (!nextDescription) nextDescription = t.name
      }
    }
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentTasks.entityOrder) })
      .from(hazidAssessmentTasks)
      .where(eq(hazidAssessmentTasks.assessmentId, assessmentId))
    const order = (maxOrder?.m ?? 0) + 1
    await tx.insert(hazidAssessmentTasks).values({
      tenantId: ctx.tenantId,
      assessmentId,
      taskId,
      description: nextDescription,
      hazardIds,
      controls: nextControls,
      entityOrder: order,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: taskId ? 'Added task from library' : 'Added ad-hoc task',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function updateTask(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  const description = nullable(formData.get('description'))
  const controls = nullable(formData.get('controls'))
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .update(hazidAssessmentTasks)
      .set({ description, controls })
      .where(
        and(eq(hazidAssessmentTasks.id, id), eq(hazidAssessmentTasks.assessmentId, assessmentId)),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_task',
      entityId: id,
      action: 'update',
      summary: 'Updated task',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function deleteTask(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .delete(hazidAssessmentTasks)
      .where(
        and(eq(hazidAssessmentTasks.id, id), eq(hazidAssessmentTasks.assessmentId, assessmentId)),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_task',
      entityId: id,
      action: 'delete',
      summary: 'Deleted task',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function moveTask(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await assertAssessmentEditable(ctx, assessmentId)
  await reorderEntities(
    ctx,
    hazidAssessmentTasks,
    assessmentId,
    id,
    direction as 'up' | 'down',
    'Reordered tasks',
  )
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Hazards
// ------------------------------------------------------------------
export async function addHazard(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const hazardId = String(formData.get('hazardId') ?? '').trim() || null
  const name = String(formData.get('name') ?? '').trim() || null
  if (!assessmentId) throw new Error('Missing assessmentId')
  await assertAssessmentEditable(ctx, assessmentId)

  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    let standardControls: string | null = null
    if (hazardId) {
      const [h] = await tx.select().from(hazidHazards).where(eq(hazidHazards.id, hazardId)).limit(1)
      standardControls = h?.standardControls ?? null
    }
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentHazards.entityOrder) })
      .from(hazidAssessmentHazards)
      .where(eq(hazidAssessmentHazards.assessmentId, assessmentId))
    await tx.insert(hazidAssessmentHazards).values({
      tenantId: ctx.tenantId,
      assessmentId,
      hazardId,
      name,
      standardControls,
      applicable: true,
      entityOrder: (maxOrder?.m ?? 0) + 1,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: hazardId ? 'Added hazard from library' : 'Added ad-hoc hazard',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function addHazardSet(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const setId = String(formData.get('setId') ?? '')
  if (!assessmentId || !setId) throw new Error('Missing ids')
  await assertAssessmentEditable(ctx, assessmentId)
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    const [set] = await tx
      .select()
      .from(hazidHazardSets)
      .where(eq(hazidHazardSets.id, setId))
      .limit(1)
    if (!set || set.hazardIds.length === 0) return
    const hazRows = await tx
      .select()
      .from(hazidHazards)
      .where(and(sql`${hazidHazards.id} = ANY(${set.hazardIds})`, isNull(hazidHazards.deletedAt)))
    if (hazRows.length === 0) return
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentHazards.entityOrder) })
      .from(hazidAssessmentHazards)
      .where(eq(hazidAssessmentHazards.assessmentId, assessmentId))
    let next = (maxOrder?.m ?? 0) + 1
    await tx.insert(hazidAssessmentHazards).values(
      hazRows.map((h) => ({
        tenantId: ctx.tenantId,
        assessmentId,
        hazardId: h.id,
        standardControls: h.standardControls,
        applicable: true,
        entityOrder: next++,
      })),
    )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: 'Added hazard set',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function updateHazard(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  const specificControls = nullable(formData.get('specificControls'))
  const applicable = formData.get('applicable') === 'on' || formData.get('applicable') === 'true'
  const standardControls = nullable(formData.get('standardControls'))
  const name = nullable(formData.get('name'))
  // Risk-rating fields are optional 1..RISK_AXIS_MAX ints; absent → leave the
  // column alone, empty → null it out, otherwise clamp into the valid range.
  const updates: Record<string, unknown> = { specificControls, applicable }
  if (standardControls !== undefined) updates.standardControls = standardControls
  if (name !== undefined) updates.name = name
  if (formData.has('preLikelihood'))
    updates.preLikelihood = riskRating(formData.get('preLikelihood'))
  if (formData.has('preSeverity')) updates.preSeverity = riskRating(formData.get('preSeverity'))
  if (formData.has('postLikelihood'))
    updates.postLikelihood = riskRating(formData.get('postLikelihood'))
  if (formData.has('postSeverity')) updates.postSeverity = riskRating(formData.get('postSeverity'))
  if (formData.has('controls')) updates.controls = nullable(formData.get('controls'))
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .update(hazidAssessmentHazards)
      .set(updates)
      .where(
        and(
          eq(hazidAssessmentHazards.id, id),
          eq(hazidAssessmentHazards.assessmentId, assessmentId),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_hazard',
      entityId: id,
      action: 'update',
      summary: 'Updated hazard',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function deleteHazard(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .delete(hazidAssessmentHazards)
      .where(
        and(
          eq(hazidAssessmentHazards.id, id),
          eq(hazidAssessmentHazards.assessmentId, assessmentId),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_hazard',
      entityId: id,
      action: 'delete',
      summary: 'Deleted hazard',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function moveHazard(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await assertAssessmentEditable(ctx, assessmentId)
  await reorderEntities(
    ctx,
    hazidAssessmentHazards,
    assessmentId,
    id,
    direction as 'up' | 'down',
    'Reordered hazards',
  )
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// PPE
// ------------------------------------------------------------------
export async function addPPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!assessmentId || !name) throw new Error('Missing fields')
  await assertAssessmentEditable(ctx, assessmentId)
  const description = nullable(formData.get('description'))
  const required = formData.get('required') === 'on' || formData.get('required') === 'true'
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentPPE.entityOrder) })
      .from(hazidAssessmentPPE)
      .where(eq(hazidAssessmentPPE.assessmentId, assessmentId))
    await tx.insert(hazidAssessmentPPE).values({
      tenantId: ctx.tenantId,
      assessmentId,
      name,
      description,
      required,
      entityOrder: (maxOrder?.m ?? 0) + 1,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: `Added PPE row "${name}"`,
    })
  })
  revalidateAssessment(assessmentId)
}

export async function updatePPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  const name = String(formData.get('name') ?? '').trim() || undefined
  const description = nullable(formData.get('description'))
  const required = formData.get('required') === 'on' || formData.get('required') === 'true'
  const updates: Record<string, unknown> = { description, required }
  if (name) updates.name = name
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .update(hazidAssessmentPPE)
      .set(updates)
      .where(and(eq(hazidAssessmentPPE.id, id), eq(hazidAssessmentPPE.assessmentId, assessmentId)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_ppe',
      entityId: id,
      action: 'update',
      summary: 'Updated PPE row',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function answerPPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const answer = String(formData.get('answer') ?? '')
  if (!['yes', 'no', 'na'].includes(answer)) throw new Error('Bad answer')
  await assertAssessmentEditable(ctx, assessmentId)
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .update(hazidAssessmentPPE)
      .set({ answer: answer as 'yes' | 'no' | 'na' })
      .where(and(eq(hazidAssessmentPPE.id, id), eq(hazidAssessmentPPE.assessmentId, assessmentId)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_ppe',
      entityId: id,
      action: 'update',
      summary: `Answered PPE row: ${answer}`,
    })
  })
  revalidateAssessment(assessmentId)
}

export async function deletePPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .delete(hazidAssessmentPPE)
      .where(and(eq(hazidAssessmentPPE.id, id), eq(hazidAssessmentPPE.assessmentId, assessmentId)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_ppe',
      entityId: id,
      action: 'delete',
      summary: 'Deleted PPE row',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function movePPE(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await assertAssessmentEditable(ctx, assessmentId)
  await reorderEntities(
    ctx,
    hazidAssessmentPPE,
    assessmentId,
    id,
    direction as 'up' | 'down',
    'Reordered PPE',
  )
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Questions
// ------------------------------------------------------------------
export async function addQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const question = String(formData.get('question') ?? '').trim()
  if (!assessmentId || !question) throw new Error('Missing fields')
  await assertAssessmentEditable(ctx, assessmentId)
  const questionType = String(formData.get('questionType') ?? 'yes_no') as
    'yes_no' | 'text' | 'multi_select'
  const requiresYes = formData.get('requiresYes') === 'on' || formData.get('requiresYes') === 'true'
  const answersRaw = String(formData.get('answers') ?? '').trim()
  const answers = answersRaw
    ? answersRaw
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : []
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    const [maxOrder] = await tx
      .select({ m: max(hazidAssessmentQuestions.entityOrder) })
      .from(hazidAssessmentQuestions)
      .where(eq(hazidAssessmentQuestions.assessmentId, assessmentId))
    await tx.insert(hazidAssessmentQuestions).values({
      tenantId: ctx.tenantId,
      assessmentId,
      question,
      questionType,
      answers,
      requiresYes,
      entityOrder: (maxOrder?.m ?? 0) + 1,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: 'Added question',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function answerQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  const answer = nullable(formData.get('answer'))
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .update(hazidAssessmentQuestions)
      .set({ answer })
      .where(
        and(
          eq(hazidAssessmentQuestions.id, id),
          eq(hazidAssessmentQuestions.assessmentId, assessmentId),
        ),
      )
    const [assessment] = await tx
      .select({ assessmentTypeId: hazidAssessments.assessmentTypeId })
      .from(hazidAssessments)
      .where(eq(hazidAssessments.id, assessmentId))
      .limit(1)
    await createAutoAssessmentApps(tx, {
      ctx,
      tenantId: ctx.tenantId,
      assessmentId,
      assessmentTypeId: assessment?.assessmentTypeId ?? null,
      submittedBy: ctx.membership?.id ?? null,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_question',
      entityId: id,
      action: 'update',
      summary: 'Answered question',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function updateQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  const question = String(formData.get('question') ?? '').trim() || undefined
  const requiresYes = formData.get('requiresYes') === 'on' || formData.get('requiresYes') === 'true'
  const updates: Record<string, unknown> = { requiresYes }
  if (question) updates.question = question
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .update(hazidAssessmentQuestions)
      .set(updates)
      .where(
        and(
          eq(hazidAssessmentQuestions.id, id),
          eq(hazidAssessmentQuestions.assessmentId, assessmentId),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_question',
      entityId: id,
      action: 'update',
      summary: 'Updated question',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function deleteQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .delete(hazidAssessmentQuestions)
      .where(
        and(
          eq(hazidAssessmentQuestions.id, id),
          eq(hazidAssessmentQuestions.assessmentId, assessmentId),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_question',
      entityId: id,
      action: 'delete',
      summary: 'Deleted question',
    })
  })
  revalidateAssessment(assessmentId)
}

export async function moveQuestion(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await assertAssessmentEditable(ctx, assessmentId)
  await reorderEntities(
    ctx,
    hazidAssessmentQuestions,
    assessmentId,
    id,
    direction as 'up' | 'down',
    'Reordered questions',
  )
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Signatures
// ------------------------------------------------------------------
export async function addSignature(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const signatureType = String(formData.get('signatureType') ?? 'internal') as
    'internal' | 'external'
  // Only keep the identity field that matches the signer type so a stale value
  // from the other mode can never be stored (and displayed) alongside it.
  const personId =
    signatureType === 'internal' ? String(formData.get('personId') ?? '').trim() || null : null
  const externalName =
    signatureType === 'external' ? String(formData.get('externalName') ?? '').trim() || null : null
  const signatureDataUrl = String(formData.get('signatureDataUrl') ?? '').trim() || null
  const csEntrant = formData.get('csEntrant') === 'on' || formData.get('csEntrant') === 'true'
  const csAttendant = formData.get('csAttendant') === 'on' || formData.get('csAttendant') === 'true'
  const csRescue = formData.get('csRescue') === 'on' || formData.get('csRescue') === 'true'
  if (!assessmentId) throw new Error('Missing assessmentId')
  if (signatureType === 'internal' && !personId)
    throw new Error('Internal signer requires a person')
  if (signatureType === 'external' && !externalName)
    throw new Error('External signer requires a name')
  await assertAssessmentEditable(ctx, assessmentId)

  const row = await withStoredSignatureAttachment(
    ctx,
    signatureDataUrl,
    async (tx, attachmentId) => {
      await lockEditableAssessment(ctx, tx, assessmentId)
      const [created] = await tx
        .insert(hazidAssessmentSignatures)
        .values({
          tenantId: ctx.tenantId,
          assessmentId,
          signatureType,
          personId,
          externalName,
          signatureAttachmentId: attachmentId,
          csEntrant,
          csAttendant,
          csRescue,
          signedAt: attachmentId ? new Date() : null,
        })
        .returning()
      if (created?.signatureAttachmentId) {
        await recordModuleFlowEvent(tx, ctx, {
          subjectId: assessmentId,
          moduleKey: 'hazid',
          event: 'on_sign',
          occurrenceKey: created.id,
        })
      }
      if (!created) throw new Error('Signature could not be added')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'hazid_assessment_signature',
        entityId: created.id,
        action: 'sign',
        summary: `Added ${signatureType} ${attachmentId ? 'signature' : 'signer'}`,
      })
      return created
    },
  )
  void row
  revalidateAssessment(assessmentId)
}

export async function deleteSignature(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    const [signature] = await tx
      .select({ signatureAttachmentId: hazidAssessmentSignatures.signatureAttachmentId })
      .from(hazidAssessmentSignatures)
      .where(
        and(
          eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
          eq(hazidAssessmentSignatures.id, id),
          eq(hazidAssessmentSignatures.assessmentId, assessmentId),
        ),
      )
      .limit(1)
      .for('update')
    if (!signature) throw new Error('Signature not found')
    await tx
      .delete(hazidAssessmentSignatures)
      .where(
        and(
          eq(hazidAssessmentSignatures.id, id),
          eq(hazidAssessmentSignatures.assessmentId, assessmentId),
        ),
      )
    if (signature.signatureAttachmentId) {
      await tx
        .delete(attachments)
        .where(
          and(
            eq(attachments.tenantId, ctx.tenantId),
            eq(attachments.id, signature.signatureAttachmentId),
            eq(attachments.kind, 'signature'),
          ),
        )
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment_signature',
      entityId: id,
      action: 'delete',
      summary: 'Deleted signature',
    })
  })
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Photos
// ------------------------------------------------------------------
export async function attachPhotos(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const ids = String(formData.get('attachmentIds') ?? '')
    .split(',')
    .filter(Boolean)
  if (!assessmentId || ids.length === 0) return
  await assertAssessmentEditable(ctx, assessmentId)
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx.insert(hazidAssessmentPhotos).values(
      ids.map((attachmentId) => ({
        tenantId: ctx.tenantId,
        assessmentId,
        attachmentId,
      })),
    )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: `Attached ${ids.length} photo${ids.length === 1 ? '' : 's'}`,
    })
  })
  revalidateAssessment(assessmentId)
}

export async function deletePhoto(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  await assertAssessmentEditable(ctx, assessmentId)
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await tx
      .delete(hazidAssessmentPhotos)
      .where(
        and(eq(hazidAssessmentPhotos.id, id), eq(hazidAssessmentPhotos.assessmentId, assessmentId)),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: 'Removed photo',
    })
  })
  revalidateAssessment(assessmentId)
}

// ------------------------------------------------------------------
// Library CRUD — Hazards / Hazard types / Hazard sets / Tasks / Types
// ------------------------------------------------------------------

export async function createHazardType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const color = String(formData.get('color') ?? '#64748b').trim() || '#64748b'
  const iconKey = nullable(formData.get('iconKey'))
  const description = nullable(formData.get('description'))
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidHazardTypes)
      .values({ tenantId: ctx.tenantId, name, color, iconKey, description })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_type',
    entityId: row?.id,
    action: 'create',
    summary: `Created hazard type "${name}"`,
  })
  revalidatePath('/hazard-assessments/hazards/types')
}

export async function updateHazardType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const updates = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    color: String(formData.get('color') ?? '').trim() || undefined,
    iconKey: nullable(formData.get('iconKey')),
    description: nullable(formData.get('description')),
  }
  await ctx.db((tx) => tx.update(hazidHazardTypes).set(updates).where(eq(hazidHazardTypes.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_type',
    entityId: id,
    action: 'update',
    summary: 'Updated hazard type',
  })
  revalidatePath('/hazard-assessments/hazards/types')
}

export async function deleteHazardType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(hazidHazardTypes).where(eq(hazidHazardTypes.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_type',
    entityId: id,
    action: 'delete',
    summary: 'Deleted hazard type',
  })
  revalidatePath('/hazard-assessments/hazards/types')
}

export async function createHazardLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const hazardTypeId = nullable(formData.get('hazardTypeId'))
  const description = nullable(formData.get('description'))
  const standardControls = nullable(formData.get('standardControls'))
  const risks = nullable(formData.get('risks'))
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidHazards)
      .values({ tenantId: ctx.tenantId, name, hazardTypeId, description, standardControls, risks })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard',
    entityId: row?.id,
    action: 'create',
    summary: `Created hazard "${name}"`,
  })
  revalidatePath('/hazard-assessments/hazards')
}

export async function updateHazardLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const updates = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    hazardTypeId: nullable(formData.get('hazardTypeId')),
    description: nullable(formData.get('description')),
    standardControls: nullable(formData.get('standardControls')),
    risks: nullable(formData.get('risks')),
  }
  await ctx.db((tx) => tx.update(hazidHazards).set(updates).where(eq(hazidHazards.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard',
    entityId: id,
    action: 'update',
    summary: 'Updated hazard',
  })
  revalidatePath('/hazard-assessments/hazards')
}

export async function deleteHazardLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx.update(hazidHazards).set({ deletedAt: new Date() }).where(eq(hazidHazards.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard',
    entityId: id,
    action: 'delete',
    summary: 'Deleted hazard',
  })
  revalidatePath('/hazard-assessments/hazards')
}

export async function createHazardSet(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = nullable(formData.get('description'))
  const hazardIds = String(formData.get('hazardIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidHazardSets)
      .values({ tenantId: ctx.tenantId, name, description, hazardIds })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_set',
    entityId: row?.id,
    action: 'create',
    summary: `Created hazard set "${name}"`,
  })
  revalidatePath('/hazard-assessments/hazards/sets')
}

export async function updateHazardSet(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const hazardIds = String(formData.get('hazardIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const updates = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    description: nullable(formData.get('description')),
    hazardIds,
  }
  await ctx.db((tx) => tx.update(hazidHazardSets).set(updates).where(eq(hazidHazardSets.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_set',
    entityId: id,
    action: 'update',
    summary: 'Updated hazard set',
  })
  revalidatePath('/hazard-assessments/hazards/sets')
}

export async function deleteHazardSet(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) => tx.delete(hazidHazardSets).where(eq(hazidHazardSets.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_hazard_set',
    entityId: id,
    action: 'delete',
    summary: 'Deleted hazard set',
  })
  revalidatePath('/hazard-assessments/hazards/sets')
}

export async function createTaskLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = nullable(formData.get('description'))
  const controls = nullableRichText(formData.get('controls'))
  const hazardIds = String(formData.get('hazardIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidTasks)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        controls,
        hazardIds,
        preLikelihood: riskRating(formData.get('preLikelihood')),
        preSeverity: riskRating(formData.get('preSeverity')),
        postLikelihood: riskRating(formData.get('postLikelihood')),
        postSeverity: riskRating(formData.get('postSeverity')),
      })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_task',
    entityId: row?.id,
    action: 'create',
    summary: `Created task "${name}"`,
  })
  revalidatePath('/hazard-assessments/tasks')
}

export async function updateTaskLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  const hazardIds = String(formData.get('hazardIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const updates = {
    name: String(formData.get('name') ?? '').trim() || undefined,
    description: nullable(formData.get('description')),
    controls: nullableRichText(formData.get('controls')),
    hazardIds,
    preLikelihood: riskRating(formData.get('preLikelihood')),
    preSeverity: riskRating(formData.get('preSeverity')),
    postLikelihood: riskRating(formData.get('postLikelihood')),
    postSeverity: riskRating(formData.get('postSeverity')),
  }
  await ctx.db((tx) => tx.update(hazidTasks).set(updates).where(eq(hazidTasks.id, id)))
  await recordAudit(ctx, {
    entityType: 'hazid_task',
    entityId: id,
    action: 'update',
    summary: 'Updated task',
  })
  revalidatePath('/hazard-assessments/tasks')
  revalidatePath(`/hazard-assessments/tasks/${id}`)
}

export async function deleteTaskLibrary(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const id = String(formData.get('id') ?? '')
  await ctx.db((tx) =>
    tx.update(hazidTasks).set({ deletedAt: new Date() }).where(eq(hazidTasks.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_task',
    entityId: id,
    action: 'delete',
    summary: 'Deleted task',
  })
  revalidatePath('/hazard-assessments/tasks')
}

export async function createAssessmentType(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCanManageModule(ctx, 'hazid')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const rawStyle = String(formData.get('style') ?? 'task_based')
  const style = rawStyle === 'hazard_based' ? 'hazard_based' : 'task_based'
  const flag = (k: string) => formData.get(k) === 'on' || formData.get(k) === 'true'
  const availableToGroupIds = String(formData.get('availableToGroupIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidAssessmentTypes)
      .values({
        tenantId: ctx.tenantId,
        name,
        description: nullable(formData.get('description')),
        style,
        hasPPE: flag('hasPPE'),
        hasQuestions: flag('hasQuestions'),
        defaultHazardSetId:
          style === 'hazard_based' ? nullable(formData.get('defaultHazardSetId')) : null,
        availableToGroupIds,
      })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_type',
    entityId: row?.id,
    action: 'create',
    summary: `Created assessment type "${name}"`,
  })
  revalidatePath('/hazard-assessments/types')
}

// ------------------------------------------------------------------
// Utility helpers
// ------------------------------------------------------------------
function nullable(v: FormDataEntryValue | null): string | null {
  if (v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function nullableRichText(v: FormDataEntryValue | null): string | null {
  const raw = nullable(v)
  if (!raw) return null
  const clean = sanitizeDocumentHtml(raw)
  return htmlToText(clean) ? clean : null
}

// Generic reorder: untyped pass-through to avoid Drizzle's structural-table
// inference complaining when the same helper is used for different tables.
async function reorderEntities(
  ctx: HazidCtx,
  table: any,
  assessmentId: string,
  rowId: string,
  direction: 'up' | 'down',
  auditSummary: string,
) {
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    const t = table as any
    const rows = (await tx
      .select({ id: t.id, entityOrder: t.entityOrder })
      .from(t)
      .where(eq(t.assessmentId, assessmentId))
      .orderBy(asc(t.entityOrder))) as { id: string; entityOrder: number }[]
    const idx = rows.findIndex((r) => r.id === rowId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= rows.length) return
    const a = rows[idx]
    const b = rows[swapIdx]
    if (!a || !b) return
    await tx.update(t).set({ entityOrder: b.entityOrder }).where(eq(t.id, a.id))
    await tx.update(t).set({ entityOrder: a.entityOrder }).where(eq(t.id, b.id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: auditSummary,
      metadata: { rowId, direction },
    })
  })
}
