'use server'

import { activePeopleWhere } from '@beaconhs/db'

// All server actions used by the HazID detail page and its sub-sections.
// Keep these co-located so the detail page wiring is straightforward and the
// audit-log call is consistent.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm'
import { assertCan, can } from '@beaconhs/tenant'
import { htmlToText, sanitizeDocumentHtml } from '@beaconhs/forms-core'
import {
  attachments,
  formResponses,
  formTemplates,
  formTemplateVersions,
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
import { canDeleteOwnRecord } from '@/lib/record-delete-policy'
import { canManageModule, assertCanManageModule } from '@/lib/module-admin/guard'
import {
  freezeHazidSigning,
  setHazidAppsLocked as setLinkedAssessmentAppsLocked,
} from '@/lib/hazid-signing'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import {
  domainEventActor,
  moduleFlowCommand,
  recordDomainEvent,
  recordModuleFlowEvent,
} from '@beaconhs/events'
import { hazardAssessmentCreatedEvent } from '@beaconhs/integrations'
import { nextReference } from '@/lib/reference'
import { parseDatetimeLocal } from '@/lib/datetime'
import { isUuid } from '@/lib/list-params'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { canAccessTemplate, canEditResponsePayload } from '@/app/(app)/apps/_lib/access'
import { riskRating } from './_risk-scale'
import { hazidAppIsApplicable } from '@/lib/hazid-app-condition'
import { parsePhotoEdits } from '@/lib/photo-edits'
import { validateTenantImageAttachmentIdsInTx } from '@/lib/attachment-validation'
import {
  ASSESSMENT_LOCKED_MESSAGE,
  assessmentPaths,
  createAssessmentAppResponse,
  createAutoAssessmentApps,
  lockEditableAssessment,
  lockVisibleAssessment,
  lockVisibleAssessmentRow,
  updateAssessmentHazardRow,
  type AssessmentHazardUpdate,
  type HazidCtx,
} from './_assessment-rules'
import { copyAssessmentInTransaction } from './_copy-assessment'
import { withCopiedAttachments } from '@/lib/copy-attachments'
import { nullableText, postedFlag } from './_assessment-inputs'

// All HazID server actions assume a tenant is active (see HazidCtx).
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
  if (row.locked) throw new Error(ASSESSMENT_LOCKED_MESSAGE)
}

async function resolveAssessmentAccess(
  ctx: HazidCtx,
  assessmentId: string,
): Promise<{
  locked: boolean
  signingFrozenAt: Date | null
  signingRevision: number
  reportedByTenantUserId: string | null
}> {
  const row = await ctx.db(async (tx) => {
    const [found] = await tx
      .select({
        reportedByTenantUserId: hazidAssessments.reportedByTenantUserId,
        siteOrgUnitId: hazidAssessments.siteOrgUnitId,
        locked: hazidAssessments.locked,
        signingFrozenAt: hazidAssessments.signingFrozenAt,
        signingRevision: hazidAssessments.signingRevision,
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
  return {
    locked: row.locked,
    signingFrozenAt: row.signingFrozenAt,
    signingRevision: row.signingRevision,
    reportedByTenantUserId: row.reportedByTenantUserId,
  }
}

function revalidateAssessment(id: string) {
  for (const p of assessmentPaths(id)) revalidatePath(p)
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

  // datetime-local values are wall-clock strings — parse them in the user's
  // timezone, not the server's.
  const occurredAt = occurredAtRaw ? parseDatetimeLocal(occurredAtRaw, ctx.timezone) : new Date()
  if (!occurredAt) throw new Error('Invalid occurred date/time')

  const created = await ctx.db(async (tx) => {
    if (supervisorPersonId) {
      if (!isUuid(supervisorPersonId)) throw new Error('Choose an active supervisor')
      const [supervisor] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, supervisorPersonId), activePeopleWhere()))
        .limit(1)
      if (!supervisor) throw new Error('Choose an active supervisor')
    }
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
              .where(and(inArray(hazidHazards.id, set.hazardIds), isNull(hazidHazards.deletedAt)))
            if (hazRows.length > 0) {
              await tx.insert(hazidAssessmentHazards).values(
                hazRows.map((h, i) => ({
                  tenantId: ctx.tenantId,
                  assessmentId: row.id,
                  hazardId: h.id,
                  standardControls: h.standardControls,
                  // No-rating (checklist) types seed the legacy way: every
                  // hazard starts as not applicable and the crew opts in.
                  applicable: type.hasRiskRatings,
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
      .where(and(eq(people.userId, ctx.userId), activePeopleWhere()))
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
          isNull(formResponses.deletedAt),
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

export async function captureExternalAssessmentApp(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const assessmentId = String(formData.get('assessmentId') ?? '')
  const typeAppId = String(formData.get('typeAppId') ?? '')
  const issuer = String(formData.get('issuer') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim()
  const rawPhotoIds = String(formData.get('photoIds') ?? '')
    .split(',')
    .filter(Boolean)
  const photoIds = [...new Set(rawPhotoIds)]
  if (!isUuid(assessmentId) || !isUuid(typeAppId)) throw new Error('Invalid assessment app')
  if (
    !issuer ||
    issuer.length > 200 ||
    notes.length > 2000 ||
    photoIds.length > 10 ||
    photoIds.some((photoId) => !isUuid(photoId))
  ) {
    throw new Error('Enter a valid issuer and no more than 10 photos')
  }
  await assertCanSeeAssessment(ctx, assessmentId)
  await ctx.db(async (tx) => {
    const assessment = await lockVisibleAssessment(ctx, tx, assessmentId)
    if (assessment.locked)
      throw new Error('Unlock this assessment before capturing an external form')
    const [typeApp] = await tx
      .select({ app: hazidAssessmentTypeApps, template: formTemplates })
      .from(hazidAssessmentTypeApps)
      .innerJoin(formTemplates, eq(formTemplates.id, hazidAssessmentTypeApps.templateId))
      .where(
        and(eq(hazidAssessmentTypeApps.id, typeAppId), isNull(hazidAssessmentTypeApps.deletedAt)),
      )
      .limit(1)
    if (!typeApp?.app || typeApp.app.typeId !== assessment.assessmentTypeId) {
      throw new Error('Assessment app is not available for this type')
    }
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
      throw new Error('Answer the configured assessment question before capturing this app')
    }
    const config = typeApp.template.recordConfig as {
      externalCapture?: { enabled?: boolean; requirePhoto?: boolean }
    } | null
    if (!config?.externalCapture?.enabled)
      throw new Error('External capture is not enabled for this app')
    if (config.externalCapture.requirePhoto && photoIds.length === 0)
      throw new Error('Add at least one photo of the completed external form')
    const roleKeys = await getEffectiveRoleKeys(ctx, tx)
    if (
      !canAccessTemplate(ctx, typeApp.template, roleKeys, 'operate') ||
      !can(ctx, 'forms.response.create')
    ) {
      throw new Error('You do not have permission to complete this assessment app')
    }
    if (photoIds.length) await validateTenantImageAttachmentIdsInTx(tx, ctx.tenantId, photoIds)
    const [existing] = await tx
      .select({ responseId: hazidAssessmentAppResponses.responseId })
      .from(hazidAssessmentAppResponses)
      .innerJoin(formResponses, eq(formResponses.id, hazidAssessmentAppResponses.responseId))
      .where(
        and(
          eq(hazidAssessmentAppResponses.assessmentId, assessmentId),
          eq(hazidAssessmentAppResponses.typeAppId, typeAppId),
          isNull(formResponses.deletedAt),
        ),
      )
      .limit(1)
    if (existing) throw new Error('This assessment app already has a response')
    const [version] = await tx
      .select({ id: formTemplateVersions.id })
      .from(formTemplateVersions)
      .where(
        and(
          eq(formTemplateVersions.templateId, typeApp.template.id),
          isNotNull(formTemplateVersions.publishedAt),
        ),
      )
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    if (!version) throw new Error('No published app version found')
    const now = new Date()
    const [response] = await tx
      .insert(formResponses)
      .values({
        tenantId: ctx.tenantId,
        templateId: typeApp.template.id,
        templateVersionId: version.id,
        status: 'submitted',
        captureMode: 'external',
        externalReference: assessment.reference,
        externalIssuer: issuer,
        externalNotes: notes || null,
        submittedAt: now,
        submittedBy: ctx.membership?.id ?? null,
        siteOrgUnitId: assessment.siteOrgUnitId,
        sourceEntityType: 'hazid_assessment',
        sourceEntityId: assessmentId,
        data: { __externalPhotoIds: photoIds },
      })
      .returning()
    if (!response) throw new Error('Could not complete external capture')
    await tx.insert(hazidAssessmentAppResponses).values({
      tenantId: ctx.tenantId,
      assessmentId,
      typeAppId,
      templateId: typeApp.template.id,
      responseId: response.id,
      entityOrder: typeApp.app.entityOrder,
    })
    await recordDomainEvent(tx, {
      tenantId: ctx.tenantId,
      eventType: 'form.submitted',
      subjectId: response.id,
      dedupKey: `form.submitted:${response.id}`,
      payload: {
        web: {
          kind: 'form_submitted',
          subjectId: response.id,
          templateId: response.templateId,
          data: {
            ...(response.data as Record<string, unknown>),
            capture_mode: 'external',
            external_reference: response.externalReference,
            external_issuer: response.externalIssuer,
          },
          score: 0,
          status: 'compliant',
          recap: true,
          actor: domainEventActor(ctx),
        },
      },
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'form_response',
      entityId: response.id,
      action: 'create',
      summary: `Captured external ${typeApp.template.name} form`,
      metadata: {
        captureMode: 'external',
        externalReference: assessment.reference,
        photoCount: photoIds.length,
      },
    })
  })
  revalidateAssessment(assessmentId)
  redirect(`/hazard-assessments/${assessmentId}#section-apps` as any)
}

export async function lockAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  const id = String(formData.get('id') ?? '')
  await assertCanSeeAssessment(ctx, id)
  await ctx.db(async (tx) => {
    const assessment = await lockVisibleAssessment(ctx, tx, id)
    if (assessment.locked) throw new Error('This assessment is already locked')
    // A hazard assessment is the crew's record that they read and understood
    // the hazards. Submitting one nobody signed produces a signed-off safety
    // document with no signature on it, and the submit flows email it out as
    // if it were complete. Unsigned rows (a signer added but not yet inked)
    // do not count — readiness has always meant captured ink.
    const [signed] = await tx
      .select({ c: count() })
      .from(hazidAssessmentSignatures)
      .where(
        and(
          eq(hazidAssessmentSignatures.assessmentId, id),
          eq(hazidAssessmentSignatures.revision, assessment.signingRevision),
          isNotNull(hazidAssessmentSignatures.signatureAttachmentId),
        ),
      )
    if ((signed?.c ?? 0) === 0) {
      throw new Error(
        'This assessment has no signatures yet. Collect at least one before you submit and lock it.',
      )
    }
    const [awaiting] = await tx
      .select({ c: count() })
      .from(hazidAssessmentSignatures)
      .where(
        and(
          eq(hazidAssessmentSignatures.assessmentId, id),
          eq(hazidAssessmentSignatures.revision, assessment.signingRevision),
          isNull(hazidAssessmentSignatures.signatureAttachmentId),
        ),
      )
    if ((awaiting?.c ?? 0) > 0)
      throw new Error(
        'Collect every crew signature or remove unsigned crew members before submitting.',
      )
    if (!assessment.signingFrozenAt) {
      const [full] = await tx
        .select()
        .from(hazidAssessments)
        .where(eq(hazidAssessments.id, id))
        .limit(1)
      if (!full) throw new Error('Assessment not found')
      await freezeHazidSigning(ctx, tx, full)
    }
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
      event: 'on_submit',
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
  assertCan(ctx, 'hazid.review')
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
    if (!assessment.signingFrozenAt) {
      const [full] = await tx
        .select()
        .from(hazidAssessments)
        .where(eq(hazidAssessments.id, id))
        .limit(1)
      if (!full) throw new Error('Assessment not found')
      await freezeHazidSigning(ctx, tx, full)
    }
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
      summary: 'Unlocked assessment; signatures retained until job content changes',
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
  const id = String(formData.get('id') ?? '')
  await ctx.db(async (tx) => {
    const record = await lockVisibleAssessmentRow(ctx, tx, id, { includeDeleted: true })
    if (!record) throw new Error('Assessment not found')
    if (
      !canManageModule(ctx, 'hazid') &&
      !canDeleteOwnRecord(ctx, 'hazid.delete.own', record.reportedByTenantUserId)
    )
      throw new Error('You cannot delete this assessment.')
    // A repeated phone submission must not fail after the first delete committed.
    // Authorization still runs against the original tenant-owned record.
    if (record.deletedAt) return
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

// Copy job content into a fresh draft; signatures and approval state never carry forward.
export async function copyAssessment(formData: FormData) {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.create')
  const sourceId = String(formData.get('id') ?? '')
  if (!isUuid(sourceId)) throw new Error('Missing assessment')
  const includePhotos = formData.get('includePhotos') === '1'
  const created = await withCopiedAttachments(ctx, async (tx, files) => {
    const { source, copy } = await copyAssessmentInTransaction(
      tx,
      ctx,
      sourceId,
      includePhotos,
      files,
    )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: copy.id,
      action: 'copy',
      summary: `Copied from ${source.reference} as ${copy.reference}`,
      after: { copiedFrom: source.id, copiedFromReference: source.reference, includePhotos },
    })
    return copy
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
  const description = nullableText(formData.get('description'))
  const controls = nullableText(formData.get('controls'))
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
      .where(and(inArray(hazidHazards.id, set.hazardIds), isNull(hazidHazards.deletedAt)))
    if (hazRows.length === 0) return
    // Checklist (no-rating) types bulk-add the legacy way: hazards start as
    // not applicable and the crew opts each one in.
    const [assessmentType] = await tx
      .select({ hasRiskRatings: hazidAssessmentTypes.hasRiskRatings })
      .from(hazidAssessments)
      .innerJoin(
        hazidAssessmentTypes,
        eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId),
      )
      .where(eq(hazidAssessments.id, assessmentId))
      .limit(1)
    const defaultApplicable = assessmentType?.hasRiskRatings ?? true
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
        applicable: defaultApplicable,
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
  // Partial update: only fields present on the FormData are written (the
  // inline checklist edits single fields through the record saver, with the
  // same parse rules and the same row writer).
  const updates: AssessmentHazardUpdate = {}
  if (formData.has('specificControls'))
    updates.specificControls = nullableText(formData.get('specificControls'))
  if (formData.has('applicable')) updates.applicable = postedFlag(formData.get('applicable'))
  if (formData.has('standardControls'))
    updates.standardControls = nullableText(formData.get('standardControls'))
  if (formData.has('name')) updates.name = nullableText(formData.get('name'))
  // Risk-rating fields are optional 1..RISK_AXIS_MAX ints; absent → leave the
  // column alone, empty → null it out, otherwise clamp into the valid range.
  if (formData.has('preLikelihood'))
    updates.preLikelihood = riskRating(formData.get('preLikelihood'))
  if (formData.has('preSeverity')) updates.preSeverity = riskRating(formData.get('preSeverity'))
  if (formData.has('postLikelihood'))
    updates.postLikelihood = riskRating(formData.get('postLikelihood'))
  if (formData.has('postSeverity')) updates.postSeverity = riskRating(formData.get('postSeverity'))
  if (formData.has('controls')) updates.controls = nullableText(formData.get('controls'))
  if (Object.keys(updates).length === 0) return
  await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    await updateAssessmentHazardRow(tx, ctx, { assessmentId, hazardRowId: id, updates })
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
  const description = nullableText(formData.get('description'))
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
  const description = nullableText(formData.get('description'))
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
    const attachmentIds = await validateTenantImageAttachmentIdsInTx(tx, ctx.tenantId, ids)
    const existing = await tx
      .select({
        attachmentId: hazidAssessmentPhotos.attachmentId,
        sortOrder: hazidAssessmentPhotos.sortOrder,
      })
      .from(hazidAssessmentPhotos)
      .where(
        and(
          eq(hazidAssessmentPhotos.tenantId, ctx.tenantId),
          eq(hazidAssessmentPhotos.assessmentId, assessmentId),
        ),
      )
    const existingIds = new Set(existing.map((photo) => photo.attachmentId))
    const newAttachmentIds = attachmentIds.filter((attachmentId) => !existingIds.has(attachmentId))
    if (newAttachmentIds.length === 0) return
    const baseSortOrder =
      existing.reduce((maximum, photo) => Math.max(maximum, photo.sortOrder), -1) + 1
    await tx.insert(hazidAssessmentPhotos).values(
      newAttachmentIds.map((attachmentId, index) => ({
        tenantId: ctx.tenantId,
        assessmentId,
        attachmentId,
        sortOrder: baseSortOrder + index,
      })),
    )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: `Attached ${newAttachmentIds.length} photo${newAttachmentIds.length === 1 ? '' : 's'}`,
    })
  })
  revalidateAssessment(assessmentId)
}

export async function deletePhoto(formData: FormData) {
  return removePhoto(String(formData.get('assessmentId') ?? ''), String(formData.get('id') ?? ''))
}

export async function removePhoto(
  assessmentId: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  if (!isUuid(assessmentId) || !isUuid(id)) return { ok: false, error: 'Photo not found.' }
  await assertAssessmentEditable(ctx, assessmentId)
  const removed = await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    const rows = await tx
      .delete(hazidAssessmentPhotos)
      .where(
        and(
          eq(hazidAssessmentPhotos.tenantId, ctx.tenantId),
          eq(hazidAssessmentPhotos.id, id),
          eq(hazidAssessmentPhotos.assessmentId, assessmentId),
        ),
      )
      .returning({ id: hazidAssessmentPhotos.id })
    if (rows.length === 0) return false
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: 'Removed photo',
    })
    return true
  })
  if (!removed) return { ok: false, error: 'Photo not found.' }
  revalidateAssessment(assessmentId)
  return { ok: true }
}

export async function updatePhoto(
  assessmentId: string,
  photoId: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  if (!isUuid(assessmentId) || !isUuid(photoId)) return { ok: false, error: 'Photo not found.' }
  const edits = parsePhotoEdits(input)
  const changed = await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    const [photo] = await tx
      .select({ attachmentId: hazidAssessmentPhotos.attachmentId })
      .from(hazidAssessmentPhotos)
      .where(
        and(
          eq(hazidAssessmentPhotos.tenantId, ctx.tenantId),
          eq(hazidAssessmentPhotos.assessmentId, assessmentId),
          eq(hazidAssessmentPhotos.id, photoId),
        ),
      )
      .limit(1)
      .for('update')
    if (!photo) return false
    await tx
      .update(hazidAssessmentPhotos)
      .set({ caption: edits.caption })
      .where(
        and(
          eq(hazidAssessmentPhotos.tenantId, ctx.tenantId),
          eq(hazidAssessmentPhotos.assessmentId, assessmentId),
          eq(hazidAssessmentPhotos.id, photoId),
        ),
      )
    await tx
      .update(attachments)
      .set({ annotations: edits.annotations })
      .where(
        and(
          eq(attachments.tenantId, ctx.tenantId),
          eq(attachments.id, photo.attachmentId),
          eq(attachments.kind, 'image'),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: 'Updated photo caption and markup',
      metadata: { photoId, annotationCount: edits.annotations?.length ?? 0 },
    })
    return true
  })
  if (!changed) return { ok: false, error: 'Photo not found.' }
  revalidateAssessment(assessmentId)
  return { ok: true }
}

export async function reorderPhotos(
  assessmentId: string,
  photoIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await ctxWithTenant()
  assertCan(ctx, 'hazid.update')
  if (
    !isUuid(assessmentId) ||
    photoIds.some((photoId) => !isUuid(photoId)) ||
    new Set(photoIds).size !== photoIds.length
  ) {
    return { ok: false, error: 'Photo order is invalid.' }
  }
  const changed = await ctx.db(async (tx) => {
    await lockEditableAssessment(ctx, tx, assessmentId)
    const current = await tx
      .select({ id: hazidAssessmentPhotos.id })
      .from(hazidAssessmentPhotos)
      .where(
        and(
          eq(hazidAssessmentPhotos.tenantId, ctx.tenantId),
          eq(hazidAssessmentPhotos.assessmentId, assessmentId),
        ),
      )
      .orderBy(
        asc(hazidAssessmentPhotos.sortOrder),
        asc(hazidAssessmentPhotos.createdAt),
        asc(hazidAssessmentPhotos.id),
      )
      .for('update')
    const previousIds = current.map((photo) => photo.id)
    if (
      previousIds.length !== photoIds.length ||
      previousIds.some((photoId) => !photoIds.includes(photoId))
    ) {
      return false
    }
    if (previousIds.every((photoId, index) => photoId === photoIds[index])) return true
    for (const [sortOrder, photoId] of photoIds.entries()) {
      await tx
        .update(hazidAssessmentPhotos)
        .set({ sortOrder })
        .where(
          and(
            eq(hazidAssessmentPhotos.tenantId, ctx.tenantId),
            eq(hazidAssessmentPhotos.assessmentId, assessmentId),
            eq(hazidAssessmentPhotos.id, photoId),
          ),
        )
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'update',
      summary: 'Reordered photos',
      before: { photoIds: previousIds },
      after: { photoIds },
    })
    return true
  })
  if (!changed) return { ok: false, error: 'Photos changed before they could be reordered.' }
  revalidateAssessment(assessmentId)
  return { ok: true }
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
  const iconKey = nullableText(formData.get('iconKey'))
  const description = nullableText(formData.get('description'))
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
    iconKey: nullableText(formData.get('iconKey')),
    description: nullableText(formData.get('description')),
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
  const hazardTypeId = nullableText(formData.get('hazardTypeId'))
  const description = nullableText(formData.get('description'))
  const standardControls = nullableText(formData.get('standardControls'))
  const risks = nullableText(formData.get('risks'))
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
    hazardTypeId: nullableText(formData.get('hazardTypeId')),
    description: nullableText(formData.get('description')),
    standardControls: nullableText(formData.get('standardControls')),
    risks: nullableText(formData.get('risks')),
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
  const description = nullableText(formData.get('description'))
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
    description: nullableText(formData.get('description')),
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
  const description = nullableText(formData.get('description'))
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
    description: nullableText(formData.get('description')),
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
        description: nullableText(formData.get('description')),
        style,
        hasPPE: flag('hasPPE'),
        hasQuestions: flag('hasQuestions'),
        hasRiskRatings: style === 'hazard_based' ? flag('hasRiskRatings') : true,
        defaultHazardSetId:
          style === 'hazard_based' ? nullableText(formData.get('defaultHazardSetId')) : null,
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
function nullableRichText(v: FormDataEntryValue | null): string | null {
  const raw = nullableText(v)
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
