import { and, asc, eq, inArray } from 'drizzle-orm'
import { activePeopleWhere, activeTenantUsersWhere, type Database } from '@beaconhs/db'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import {
  hazidAssessments,
  hazidAssessmentHazards,
  hazidAssessmentTasks,
  hazidAssessmentPPE,
  hazidAssessmentQuestions,
  hazidAssessmentPhotos,
  hazidAssessmentSignatures,
  people,
  tenantUsers,
} from '@beaconhs/db/schema'
import { nextReference } from '@/lib/reference'
import { createAutoAssessmentApps, lockVisibleAssessment, type HazidCtx } from './_assessment-rules'
import { copyAssessmentApps } from './_copy-apps'
import type { AttachmentCopier } from '@/lib/copy-attachments'

/** The one copy path: a fresh draft with the complete reusable job content. */
export async function copyAssessmentInTransaction(
  tx: Database,
  ctx: HazidCtx,
  sourceId: string,
  includePhotos: boolean,
  files: AttachmentCopier,
) {
  const src = await lockVisibleAssessment(ctx, tx, sourceId)
  // Reuse the same numbering scheme as createAssessment so references stay
  // consistent: HAZ-<year>-<counter>.
  const reference = await nextReference(tx, ctx.tenantId, 'hazid')

  const [supervisor] = src.supervisorPersonId
    ? await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, src.supervisorPersonId), activePeopleWhere()))
        .limit(1)
    : []
  const [supervisorAccount] = src.supervisorTenantUserId
    ? await tx
        .select({ id: tenantUsers.id })
        .from(tenantUsers)
        .where(and(eq(tenantUsers.id, src.supervisorTenantUserId), activeTenantUsersWhere()))
        .limit(1)
    : []
  const jobScope = src.jobScope ? sanitizeDocumentHtml(src.jobScope) : null

  const [row] = await tx
    .insert(hazidAssessments)
    .values({
      tenantId: ctx.tenantId,
      reference,
      occurredAt: new Date(),
      siteOrgUnitId: src.siteOrgUnitId,
      projectOrgUnitId: src.projectOrgUnitId,
      locationOnSite: src.locationOnSite,
      supervisorPersonId: supervisor?.id ?? null,
      supervisorTenantUserId: supervisorAccount?.id ?? null,
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

  // Carry the selected PPE and answers into the new draft.
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
        answer: p.answer,
      })),
    )
  }

  // Answers also control which attached plans are applicable.
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
        answer: q.answer,
      })),
    )
  }

  // Crew identities carry forward; every person signs the new assessment.
  const crew = await tx
    .select()
    .from(hazidAssessmentSignatures)
    .where(
      and(
        eq(hazidAssessmentSignatures.assessmentId, src.id),
        eq(hazidAssessmentSignatures.revision, src.signingRevision),
      ),
    )
    .orderBy(asc(hazidAssessmentSignatures.createdAt), asc(hazidAssessmentSignatures.id))
  const activePeople = crew.some((member) => member.personId)
    ? await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            activePeopleWhere(),
            inArray(
              people.id,
              crew.flatMap((member) => (member.personId ? [member.personId] : [])),
            ),
          ),
        )
    : []
  const eligible = new Set(activePeople.map((person) => person.id))
  const unsigned = crew.filter(
    (member) =>
      member.signatureType === 'external' || (member.personId && eligible.has(member.personId)),
  )
  if (unsigned.length)
    await tx.insert(hazidAssessmentSignatures).values(
      unsigned.map((member) => ({
        tenantId: ctx.tenantId,
        assessmentId: row.id,
        revision: row.signingRevision,
        signatureType: member.signatureType,
        personId: member.personId,
        externalName: member.externalName,
        csEntrant: member.csEntrant,
        csAttendant: member.csAttendant,
        csRescue: member.csRescue,
      })),
    )
  if (includePhotos) {
    const photos = await tx
      .select()
      .from(hazidAssessmentPhotos)
      .where(eq(hazidAssessmentPhotos.assessmentId, src.id))
    const photoCopies = []
    for (const photo of photos)
      photoCopies.push({ ...photo, attachmentId: await files.attachment(tx, photo.attachmentId) })
    if (photoCopies.length)
      await tx.insert(hazidAssessmentPhotos).values(
        photoCopies.map((photo) => ({
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          attachmentId: photo.attachmentId,
          caption: photo.caption,
          sortOrder: photo.sortOrder,
        })),
      )
  }
  await copyAssessmentApps(tx, ctx, src.id, row, includePhotos, files)
  await createAutoAssessmentApps(tx, {
    ctx,
    tenantId: ctx.tenantId,
    assessmentId: row.id,
    assessmentTypeId: src.assessmentTypeId,
    submittedBy: ctx.membership?.id ?? null,
  })

  return { source: src, copy: row }
}
