import 'server-only'

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { activePeopleWhere, activeTenantUsersWhere, type Database } from '@beaconhs/db'
import {
  formResponses,
  formTemplates,
  formTemplateVersions,
  hazidAssessmentAppResponses,
  hazidAssessments,
  hazidAssessmentSignatures,
  hazidSigningRounds,
  people,
  tenantUsers,
  type HazidSigningSnapshot,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { HazidSigningError } from './hazid-signing-result'
import { canSeeRecord } from './visibility'
import { createHazidFlowAdapter } from './flows/adapters/hazid'
import { loadEntitiesForPickers } from '@/app/(app)/apps/_lib/entity-loader'
import { responsePayload } from '@/app/(app)/apps/_lib/response-payload'

export type SigningContext = RequestContext & { tenantId: string }
export const SIGNING_REQUEST_DAYS = 7
export const MAX_SIGNING_CREW = 250

/** Parent lock is acquired first by every signing/content mutation. */
export async function lockHazidForSigning(
  ctx: SigningContext,
  tx: Database,
  id: string,
  ownSignatureId?: string,
) {
  const [assessment] = await tx
    .select()
    .from(hazidAssessments)
    .where(
      and(
        eq(hazidAssessments.tenantId, ctx.tenantId),
        eq(hazidAssessments.id, id),
        isNull(hazidAssessments.deletedAt),
      ),
    )
    .for('update')
    .limit(1)
  if (!assessment) throw new HazidSigningError('Assessment not found')
  if (ownSignatureId) {
    await requireOwnHazidSignature(ctx, tx, ownSignatureId, id)
  } else if (
    !(await canSeeRecord(ctx, tx, {
      prefix: 'hazid',
      ownerIds: [assessment.reportedByTenantUserId],
      siteId: assessment.siteOrgUnitId,
    }))
  ) {
    throw new HazidSigningError('Assessment not found')
  }
  if (assessment.locked) throw new HazidSigningError('This assessment is locked')
  return assessment
}

/** An active account can review and sign only its own current requested slot. */
export async function requireOwnHazidSignature(
  ctx: SigningContext,
  tx: Database,
  signatureId: string,
  assessmentId?: string,
) {
  const [row] = await tx
    .select({ signature: hazidAssessmentSignatures, assessment: hazidAssessments })
    .from(hazidAssessmentSignatures)
    .innerJoin(
      hazidAssessments,
      and(
        eq(hazidAssessments.tenantId, hazidAssessmentSignatures.tenantId),
        eq(hazidAssessments.id, hazidAssessmentSignatures.assessmentId),
        eq(hazidAssessments.signingRevision, hazidAssessmentSignatures.revision),
      ),
    )
    .innerJoin(
      people,
      and(
        eq(people.tenantId, hazidAssessmentSignatures.tenantId),
        eq(people.id, hazidAssessmentSignatures.personId),
      ),
    )
    .innerJoin(
      tenantUsers,
      and(eq(tenantUsers.tenantId, people.tenantId), eq(tenantUsers.userId, people.userId)),
    )
    .where(
      and(
        eq(hazidAssessmentSignatures.id, signatureId),
        eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
        assessmentId ? eq(hazidAssessments.id, assessmentId) : undefined,
        eq(people.userId, ctx.userId),
        activePeopleWhere(),
        activeTenantUsersWhere(),
        isNull(hazidAssessments.deletedAt),
      ),
    )
    .limit(1)
  if (!row || !row.signature.requestId || !row.assessment.signingFrozenAt)
    throw new HazidSigningError('Signature request not found')
  if (
    !row.signature.signedAt &&
    (!row.signature.requestExpiresAt || row.signature.requestExpiresAt <= new Date())
  )
    throw new HazidSigningError(
      'This signature request has expired. Ask the supervisor to resend it.',
    )
  return row
}

export async function setHazidAppsLocked(
  tx: Database,
  args: {
    tenantId: string
    assessmentId: string
    locked: boolean
    lockedAt: Date | null
    lockedByTenantUserId: string | null
  },
) {
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
  if (rows.length)
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
          inArray(
            formResponses.id,
            rows.map((r) => r.id),
          ),
          isNull(formResponses.deletedAt),
        ),
      )
}

export async function freezeHazidSigning(
  ctx: SigningContext,
  tx: Database,
  assessment: typeof hazidAssessments.$inferSelect,
) {
  if (assessment.signingFrozenAt) return
  const now = new Date()
  await tx
    .update(hazidAssessmentSignatures)
    .set({
      signerName: sql`coalesce(${hazidAssessmentSignatures.externalName}, (select concat_ws(' ', ${people.firstName}, ${people.lastName}) from ${people} where ${people.tenantId} = ${hazidAssessmentSignatures.tenantId} and ${people.id} = ${hazidAssessmentSignatures.personId}))`,
    })
    .where(
      and(
        eq(hazidAssessmentSignatures.assessmentId, assessment.id),
        eq(hazidAssessmentSignatures.revision, assessment.signingRevision),
        isNull(hazidAssessmentSignatures.signerName),
      ),
    )
  await setHazidAppsLocked(tx, {
    tenantId: ctx.tenantId,
    assessmentId: assessment.id,
    locked: true,
    lockedAt: now,
    lockedByTenantUserId: ctx.membership?.id ?? null,
  })
  const transactionCtx: SigningContext = { ...ctx, db: (run) => run(tx) }
  const values = await createHazidFlowAdapter(transactionCtx, assessment.id, true).loadValues()
  // Crew slots can change without changing the reviewed job content.
  delete values.signatures
  values.occurred_at = new Intl.DateTimeFormat(ctx.locale, {
    timeZone: ctx.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(assessment.occurredAt)
  const linked = await tx
    .select({ template: formTemplates, version: formTemplateVersions, response: formResponses })
    .from(hazidAssessmentAppResponses)
    .innerJoin(
      formResponses,
      and(
        eq(formResponses.tenantId, hazidAssessmentAppResponses.tenantId),
        eq(formResponses.id, hazidAssessmentAppResponses.responseId),
      ),
    )
    .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
    .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
    .where(
      and(
        eq(hazidAssessmentAppResponses.tenantId, ctx.tenantId),
        eq(hazidAssessmentAppResponses.assessmentId, assessment.id),
        isNull(formResponses.deletedAt),
      ),
    )
    .orderBy(asc(hazidAssessmentAppResponses.entityOrder))
  const directory = await tx
    .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
    .from(people)
    .where(eq(people.tenantId, ctx.tenantId))
  const apps: HazidSigningSnapshot['apps'] = []
  for (const app of linked) {
    const appValues = responsePayload(
      app.response.data ?? {},
      app.response.status === 'draft' || app.response.status === 'in_progress'
        ? app.response.draftData
        : null,
    )
    const selected = JSON.stringify(appValues)
    apps.push({
      templateId: app.template.id,
      name: app.template.name,
      version: app.version.version,
      schema: app.version.schema,
      values: appValues,
      entities: await loadEntitiesForPickers(transactionCtx, app.version.schema, appValues),
      people: directory.filter((p) => selected.includes(p.id)),
    })
  }
  const snapshot: HazidSigningSnapshot = JSON.parse(JSON.stringify({ values, apps }))
  await tx.insert(hazidSigningRounds).values({
    tenantId: ctx.tenantId,
    assessmentId: assessment.id,
    revision: assessment.signingRevision,
    snapshot,
  })
  await tx
    .update(hazidAssessments)
    .set({ signingFrozenAt: now })
    .where(and(eq(hazidAssessments.tenantId, ctx.tenantId), eq(hazidAssessments.id, assessment.id)))
}

/** Preserve previous ink and snapshot; clone crew identities into a fresh revision. */
export async function reviseHazidSigning(
  ctx: SigningContext,
  tx: Database,
  assessmentId: string,
  revision: number,
) {
  const old = await tx
    .select()
    .from(hazidAssessmentSignatures)
    .where(
      and(
        eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
        eq(hazidAssessmentSignatures.assessmentId, assessmentId),
        eq(hazidAssessmentSignatures.revision, revision),
      ),
    )
  await tx
    .update(hazidSigningRounds)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(hazidSigningRounds.tenantId, ctx.tenantId),
        eq(hazidSigningRounds.assessmentId, assessmentId),
        eq(hazidSigningRounds.revision, revision),
      ),
    )
  const activeIds = old.flatMap((row) => (row.personId ? [row.personId] : []))
  const active = activeIds.length
    ? await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            eq(people.tenantId, ctx.tenantId),
            inArray(people.id, activeIds),
            activePeopleWhere(),
          ),
        )
    : []
  const allowed = new Set(active.map((row) => row.id))
  const next = old
    .filter((row) => !row.personId || allowed.has(row.personId))
    .map((row) => ({
      tenantId: ctx.tenantId,
      assessmentId,
      revision: revision + 1,
      signatureType: row.signatureType,
      personId: row.personId,
      externalName: row.externalName,
      signerName: row.signerName,
      csEntrant: row.csEntrant,
      csAttendant: row.csAttendant,
      csRescue: row.csRescue,
    }))
  if (next.length) await tx.insert(hazidAssessmentSignatures).values(next)
  await tx
    .update(hazidAssessments)
    .set({
      signingRevision: revision + 1,
      signingFrozenAt: null,
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewedByTenantUserId: null,
      reviewNote: null,
    })
    .where(and(eq(hazidAssessments.tenantId, ctx.tenantId), eq(hazidAssessments.id, assessmentId)))
}
