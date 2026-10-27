// Shared hazard-assessment rules: the parent-row lock every mutation takes,
// the embedded-app response creation, and the input rules the inline editors
// share with the edit drawers. Used by the Server Actions in `_actions.ts`
// and by the record saver in `_record-edits.ts` (offline-capable field edits),
// so both apply the same guards inside their own transaction.

import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  formResponses,
  formTemplateVersions,
  formTemplates,
  hazidAssessmentAppResponses,
  hazidAssessmentHazards,
  hazidAssessmentQuestions,
  hazidAssessmentTypeApps,
  hazidAssessments,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import { canAccessTemplate } from '@/app/(app)/apps/_lib/access'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { hazidAppIsApplicable } from '@/lib/hazid-app-condition'

// Every page below /hazard-assessments is tenant-scoped; requireRequestContext
// types tenantId as string | null, so callers narrow it once.
export type HazidCtx = Omit<RequestContext, 'tenantId'> & { tenantId: string }

export type HazidAssessmentRow = typeof hazidAssessments.$inferSelect

/** Paths every assessment write revalidates. */
export function assessmentPaths(assessmentId: string): string[] {
  return [`/hazard-assessments/${assessmentId}`, '/hazard-assessments']
}

export const ASSESSMENT_LOCKED_MESSAGE = 'This assessment is locked. Unlock it to make changes.'

/**
 * Lock the tenant-owned assessment row (FOR UPDATE) and re-scope it to the
 * caller: a self/site-tier user must not drive an assessment they cannot see
 * by guessing its id (prefix 'hazid', owner = reporter, site). Null when the
 * assessment is missing, soft-deleted, or not visible. Deletion retries can
 * explicitly include soft-deleted rows while keeping the same visibility check.
 */
export async function lockVisibleAssessmentRow(
  ctx: HazidCtx,
  tx: Database,
  assessmentId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<HazidAssessmentRow | null> {
  const [row] = await tx
    .select()
    .from(hazidAssessments)
    .where(
      and(
        eq(hazidAssessments.tenantId, ctx.tenantId),
        eq(hazidAssessments.id, assessmentId),
        options.includeDeleted ? undefined : isNull(hazidAssessments.deletedAt),
      ),
    )
    .limit(1)
    .for('update')
  if (!row) return null
  const visible = await canSeeRecord(ctx, tx, {
    prefix: 'hazid',
    ownerIds: [row.reportedByTenantUserId],
    siteId: row.siteOrgUnitId,
  })
  return visible ? row : null
}

export async function lockVisibleAssessment(
  ctx: HazidCtx,
  tx: Database,
  assessmentId: string,
): Promise<HazidAssessmentRow> {
  const row = await lockVisibleAssessmentRow(ctx, tx, assessmentId)
  if (!row) throw new Error('Assessment not found')
  return row
}

/**
 * Mutation guard: the visibility-scoped parent lock PLUS lock enforcement. A
 * locked (signed) assessment rejects job-content writes regardless of what is
 * posted, otherwise signatures would silently stop attesting to what was signed.
 */
export async function lockEditableAssessment(
  ctx: HazidCtx,
  tx: Database,
  assessmentId: string,
): Promise<HazidAssessmentRow> {
  const row = await lockVisibleAssessment(ctx, tx, assessmentId)
  if (row.locked) throw new Error(ASSESSMENT_LOCKED_MESSAGE)
  return row
}

async function latestTemplateVersion(tx: Database, templateId: string) {
  const [version] = await tx
    .select({ id: formTemplateVersions.id })
    .from(formTemplateVersions)
    .where(eq(formTemplateVersions.templateId, templateId))
    .orderBy(desc(formTemplateVersions.version))
    .limit(1)
  return version ?? null
}

export async function createAssessmentAppResponse(
  tx: Database,
  args: {
    tenantId: string
    assessmentId: string
    typeAppId: string
    templateId: string
    entityOrder: number
    submittedBy?: string | null
  },
) {
  const [assessment] = await tx
    .select({ siteOrgUnitId: hazidAssessments.siteOrgUnitId })
    .from(hazidAssessments)
    .where(
      and(
        eq(hazidAssessments.tenantId, args.tenantId),
        eq(hazidAssessments.id, args.assessmentId),
        isNull(hazidAssessments.deletedAt),
      ),
    )
    .limit(1)
  if (!assessment) return null

  const version = await latestTemplateVersion(tx, args.templateId)
  if (!version) return null

  // Drop stale links whose response was soft-deleted so the unique
  // (assessment_id, type_app_id) slot is free for the new response.
  const staleLinks = await tx
    .select({ id: hazidAssessmentAppResponses.id })
    .from(hazidAssessmentAppResponses)
    .innerJoin(formResponses, eq(formResponses.id, hazidAssessmentAppResponses.responseId))
    .where(
      and(
        eq(hazidAssessmentAppResponses.assessmentId, args.assessmentId),
        eq(hazidAssessmentAppResponses.typeAppId, args.typeAppId),
        isNotNull(formResponses.deletedAt),
      ),
    )
  for (const stale of staleLinks) {
    await tx.delete(hazidAssessmentAppResponses).where(eq(hazidAssessmentAppResponses.id, stale.id))
  }

  const [response] = await tx
    .insert(formResponses)
    .values({
      tenantId: args.tenantId,
      templateId: args.templateId,
      templateVersionId: version.id,
      status: 'draft',
      submittedBy: args.submittedBy ?? null,
      siteOrgUnitId: assessment.siteOrgUnitId,
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

export async function createAutoAssessmentApps(
  tx: Database,
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
      .innerJoin(formResponses, eq(formResponses.id, hazidAssessmentAppResponses.responseId))
      .where(
        and(
          eq(hazidAssessmentAppResponses.assessmentId, args.assessmentId),
          isNull(formResponses.deletedAt),
        ),
      ),
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

export type AssessmentHazardUpdate = Partial<
  Pick<
    typeof hazidAssessmentHazards.$inferInsert,
    | 'name'
    | 'standardControls'
    | 'specificControls'
    | 'applicable'
    | 'preLikelihood'
    | 'preSeverity'
    | 'controls'
    | 'postLikelihood'
    | 'postSeverity'
  >
>

/**
 * Write a hazard row of a locked assessment (the edit drawer and the inline
 * checklist both land here). Scoped to the tenant and the parent assessment,
 * so a row id from another assessment never matches.
 */
export async function updateAssessmentHazardRow(
  tx: Database,
  ctx: HazidCtx,
  args: { assessmentId: string; hazardRowId: string; updates: AssessmentHazardUpdate },
): Promise<void> {
  await tx
    .update(hazidAssessmentHazards)
    .set(args.updates)
    .where(
      and(
        eq(hazidAssessmentHazards.tenantId, ctx.tenantId),
        eq(hazidAssessmentHazards.id, args.hazardRowId),
        eq(hazidAssessmentHazards.assessmentId, args.assessmentId),
      ),
    )
}
