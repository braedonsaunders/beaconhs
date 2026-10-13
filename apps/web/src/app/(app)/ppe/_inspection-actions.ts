'use server'

// Records a PPE inspection — the one write path for both targets:
//
//   • a registered item: pre-use or annual. A failure takes the item out of
//     service and a high-severity failure opens a corrective action; a pass on
//     out-of-service gear can return it to service.
//   • other PPE that is not in the register (rental, client-supplied, a
//     subcontractor's or a worker's own gear): pre-use only. The PPE type,
//     serial, and supplier live on the inspection. There is no item to take out
//     of service, so a failure is recorded and nothing else happens.
//
// The overall result is derived from the answers; there is no manual override.

import { redirect, unstable_rethrow } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { activePeopleWhere, safeDbErrorMessage } from '@beaconhs/db'
import {
  attachments,
  orgUnits,
  people,
  ppeInspectionAttachments,
  ppeInspectionCriteria,
  ppeInspections,
  ppeItems,
  ppeTypes,
} from '@beaconhs/db/schema'
import { assertCan, can, ForbiddenError } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { materializePpeTypeEvidence } from '@/lib/compliance-type-evidence'
import { dateIsoInTimeZone } from '@/lib/datetime'
import { isUuid } from '@/lib/list-params'
import { nextPpeInspectionDue } from '@/lib/ppe-inspection-due'
import {
  applyPpeStatusTransition,
  createCorrectiveActionForFailedPpeInspection,
  loadInspectionCriteriaForType,
  shouldSpawnCorrectiveAction,
} from './_lib'

/** Where an other-PPE inspection may return to once it is recorded. */
const OTHER_RETURN_PATHS = new Set(['/ppe', '/ppe/inspections'])
const OTHER_DETAIL_MAX = 200

async function recordPpeInspection(
  formData: FormData,
): Promise<{ inspectionId: string; itemId: string | null }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.inspect')
  const isOther = formData.get('target') === 'other'
  const itemId = isOther ? null : String(formData.get('itemId') ?? '')
  const typeId = String(formData.get('typeId') ?? '')
  const kindRaw = String(formData.get('kind') ?? 'pre_use')
  const kind: 'pre_use' | 'annual' = kindRaw === 'annual' ? 'annual' : 'pre_use'
  // Annual certification of gear we do not own belongs to its owner.
  if (isOther && kind !== 'pre_use') throw new Error('Other PPE takes pre-use inspections only')
  if (kind === 'annual') assertCan(ctx, 'ppe.manage')
  const notes = String(formData.get('notes') ?? '').trim() || null
  const supervisorPersonId = String(formData.get('supervisorPersonId') ?? '').trim() || null
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const serialNumber = isOther ? String(formData.get('serialNumber') ?? '').trim() || null : null
  const suppliedBy = isOther ? String(formData.get('suppliedBy') ?? '').trim() || null : null
  if ((itemId !== null && !isUuid(itemId)) || !isUuid(typeId)) throw new Error('Invalid PPE item')
  if (supervisorPersonId && !isUuid(supervisorPersonId)) throw new Error('Invalid supervisor')
  if (siteOrgUnitId && !isUuid(siteOrgUnitId)) throw new Error('Invalid location')
  if (notes && notes.length > 10_000) throw new Error('Inspection notes are too long')
  if (
    (serialNumber?.length ?? 0) > OTHER_DETAIL_MAX ||
    (suppliedBy?.length ?? 0) > OTHER_DETAIL_MAX
  ) {
    throw new Error('Serial number and supplier must be 200 characters or fewer')
  }
  const today = dateIsoInTimeZone(new Date(), ctx.timezone)

  const criteria = await loadInspectionCriteriaForType(ctx, typeId, kind)
  if (criteria.length === 0) throw new Error('This PPE type has no criteria for that inspection')
  const escalatedFailures: {
    question: string
    reason: string
    severity: 'high' | 'critical'
  }[] = []
  let anyFail = false
  let anyApplicable = false
  const submissions: {
    criterion: (typeof criteria)[number]
    sequence: number
    answer: 'pass' | 'fail' | 'n_a'
    reason: string | null
    photoIds: string[]
  }[] = []
  for (const [sequence, c] of criteria.entries()) {
    const raw = String(formData.get(`criterion_${c.id}`) ?? '')
    // Every criterion must be answered (the client enforces this too).
    if (raw !== 'pass' && raw !== 'fail' && raw !== 'n_a') {
      throw new Error('Answer every criterion before recording the inspection')
    }
    const answer = raw as 'pass' | 'fail' | 'n_a'
    const reason = String(formData.get(`criterion_reason_${c.id}`) ?? '').trim()
    if (reason.length > 10_000) throw new Error('A criterion failure description is too long')
    if (answer === 'fail' && !reason) {
      throw new Error(`Describe what failed for “${c.question}”`)
    }
    const photoIds = Array.from(
      new Set(
        String(formData.get(`criterion_photos_${c.id}`) ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    )
    if (photoIds.some((id) => !isUuid(id))) throw new Error('Invalid inspection photo')
    if (photoIds.length > 10) throw new Error('Attach no more than 10 photos to each criterion')
    if (c.requiresPhoto && answer !== 'n_a' && photoIds.length === 0) {
      throw new Error(`Attach photo evidence for “${c.question}”`)
    }
    if (answer !== 'n_a') anyApplicable = true
    if (answer === 'fail') {
      anyFail = true
      if (!isOther && shouldSpawnCorrectiveAction(answer, c.severity)) {
        escalatedFailures.push({
          question: c.question,
          reason,
          severity: c.severity as 'high' | 'critical',
        })
      }
    }
    submissions.push({
      criterion: c,
      sequence,
      answer,
      reason: answer === 'fail' ? reason : null,
      photoIds,
    })
  }
  const allPhotoIds = submissions.flatMap((submission) => submission.photoIds)
  if (new Set(allPhotoIds).size !== allPhotoIds.length) {
    throw new Error('Each inspection photo can be attached to only one criterion')
  }
  // Derived result: any failed criterion fails the inspection; an all-N/A
  // checklist remains N/A instead of being misreported as a pass.
  const finalResult: 'pass' | 'fail' | 'n_a' = anyFail ? 'fail' : anyApplicable ? 'pass' : 'n_a'
  const kindLabel = kind === 'pre_use' ? 'pre-use' : 'annual'

  const inspectionId = await ctx.db(async (tx) => {
    const [type] = await tx
      .select({ id: ppeTypes.id, inspectionSchedule: ppeTypes.inspectionSchedule })
      .from(ppeTypes)
      .where(eq(ppeTypes.id, typeId))
      .limit(1)
      .for('share')
    if (!type) throw new Error('PPE type was not found')

    const [item] = itemId
      ? await tx
          .select({
            typeId: ppeItems.typeId,
            status: ppeItems.status,
            deletedAt: ppeItems.deletedAt,
          })
          .from(ppeItems)
          .where(eq(ppeItems.id, itemId))
          .limit(1)
          .for('update')
      : []
    if (itemId) {
      if (!item || item.typeId !== typeId) throw new Error('PPE item or type not found')
      if (item.deletedAt || item.status === 'discarded' || item.status === 'expired') {
        throw new Error('Discarded or expired PPE cannot be inspected')
      }
      // Inspecting out-of-service gear IS the return-to-service decision, so it
      // needs the narrower permission — ppe.inspect alone (which every foreman
      // holds for pre-use checks) must not be able to declare failed PPE safe.
      if (item.status === 'out_of_service' && !can(ctx, 'ppe.return_to_service')) {
        throw new Error(
          'This PPE is out of service. Only someone with permission to return PPE to service can inspect it.',
        )
      }
    }
    if (supervisorPersonId) {
      const [supervisor] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, supervisorPersonId), activePeopleWhere()))
        .limit(1)
      if (!supervisor) throw new Error('Supervisor was not found')
    }
    if (siteOrgUnitId) {
      const [site] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.id, siteOrgUnitId), isNull(orgUnits.deletedAt)))
        .limit(1)
      if (!site) throw new Error('Location was not found')
    }
    // Other PPE has no cadence of ours to schedule — the check is per use.
    const nextDueOn = itemId ? nextPpeInspectionDue(kind, today, type.inspectionSchedule) : null

    if (allPhotoIds.length > 0) {
      const ownedPhotos = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(
          and(
            eq(attachments.tenantId, ctx.tenantId),
            eq(attachments.uploadedBy, ctx.userId),
            eq(attachments.kind, 'image'),
            inArray(attachments.id, allPhotoIds),
          ),
        )
      if (ownedPhotos.length !== allPhotoIds.length) {
        throw new Error('One or more inspection photos are unavailable')
      }
    }

    const [row] = await tx
      .insert(ppeInspections)
      .values({
        tenantId: ctx.tenantId,
        itemId,
        typeId,
        isOther,
        serialNumber,
        suppliedBy,
        kind,
        status: 'submitted',
        result: finalResult,
        inspectedOn: today,
        nextDueOn,
        notes,
        siteOrgUnitId,
        inspectedByTenantUserId: ctx.membership?.id,
        inspectorNameSnapshot: ctx.membership?.displayName ?? null,
        supervisorPersonId,
      })
      .returning({ id: ppeInspections.id })
    if (!row) throw new Error('Inspection could not be recorded')

    const responseRows = await tx
      .insert(ppeInspectionCriteria)
      .values(
        submissions.map((submission) => ({
          tenantId: ctx.tenantId,
          inspectionId: row.id,
          criterionId: submission.criterion.id,
          questionTextSnapshot: submission.criterion.question,
          descriptionSnapshot: submission.criterion.description,
          severity: submission.criterion.severity,
          requiresPhoto: submission.criterion.requiresPhoto,
          sequence: submission.sequence,
          answer: submission.answer,
          nonComplianceReason: submission.reason,
        })),
      )
      .returning({ id: ppeInspectionCriteria.id, criterionId: ppeInspectionCriteria.criterionId })
    if (responseRows.length !== submissions.length) {
      throw new Error('Inspection evidence could not be recorded')
    }
    const responseByCriterion = new Map(responseRows.map((entry) => [entry.criterionId, entry.id]))
    const photoLinks = submissions.flatMap((submission) => {
      const criterionResultId = responseByCriterion.get(submission.criterion.id)
      if (!criterionResultId && submission.photoIds.length > 0) {
        throw new Error('Inspection photo evidence could not be linked')
      }
      return submission.photoIds.map((attachmentId) => ({
        tenantId: ctx.tenantId,
        criterionResultId: criterionResultId!,
        attachmentId,
      }))
    })
    if (photoLinks.length > 0) await tx.insert(ppeInspectionAttachments).values(photoLinks)

    let correctiveActionId: string | null = null
    if (itemId && item) {
      const set =
        kind === 'pre_use'
          ? { lastInspectionOn: today, nextInspectionDue: nextDueOn }
          : { lastAnnualInspectionOn: today, nextAnnualInspectionDue: nextDueOn }
      await tx.update(ppeItems).set(set).where(eq(ppeItems.id, itemId))

      // A failed inspection takes the item out of service immediately; a pass
      // on out-of-service gear clears it. The holder is preserved either way —
      // the item is physically still with whoever has it. Same transaction as
      // the inspection itself, so the two can never disagree.
      // Clearing an out-of-service item requires passing the SAME check that
      // failed it — a pre-use pass says nothing about a failed annual. If that
      // kind no longer has criteria (type edited, or the item moved types) the
      // item would otherwise be stuck out of service forever, so any pass
      // clears it in that case.
      let clearsOutOfService = false
      if (finalResult === 'pass' && item.status === 'out_of_service') {
        const [failed] = await tx
          .select({ kind: ppeInspections.kind })
          .from(ppeInspections)
          .where(and(eq(ppeInspections.itemId, itemId), eq(ppeInspections.result, 'fail')))
          .orderBy(desc(ppeInspections.inspectedOn), desc(ppeInspections.id))
          .limit(1)
        const failedKind = failed?.kind ?? null
        const failedKindStillRuns =
          failedKind === null
            ? false
            : (await loadInspectionCriteriaForType(ctx, typeId, failedKind)).length > 0
        clearsOutOfService = !failedKindStillRuns || failedKind === kind
      }
      const transition =
        finalResult === 'fail' && item.status !== 'out_of_service'
          ? ('mark_out_of_service' as const)
          : clearsOutOfService
            ? ('return_to_service' as const)
            : null
      if (transition) {
        await applyPpeStatusTransition(tx, ctx, {
          itemId,
          personId: null,
          action: transition,
          note:
            transition === 'mark_out_of_service'
              ? `Failed ${kindLabel} inspection`
              : `Passed ${kindLabel} return-to-service inspection`,
        })
      }
      if (escalatedFailures.length > 0) {
        const severity = escalatedFailures.some((failure) => failure.severity === 'critical')
          ? ('critical' as const)
          : ('high' as const)
        const primaryFailure =
          escalatedFailures.find((failure) => failure.severity === 'critical') ??
          escalatedFailures[0]!
        correctiveActionId = await createCorrectiveActionForFailedPpeInspection(tx, ctx, {
          inspectionId: row.id,
          itemId,
          title:
            escalatedFailures.length === 1
              ? `PPE inspection finding: ${primaryFailure.question.slice(0, 80)}`
              : `PPE inspection findings: ${escalatedFailures.length} high-risk failures`,
          description: [
            `PPE item ${itemId} failed a ${kindLabel} inspection.`,
            `High-risk findings:\n${escalatedFailures
              .map(
                (failure) =>
                  `- [${failure.severity.toUpperCase()}] ${failure.question}: ${failure.reason}`,
              )
              .join('\n')}`,
            notes ? `Inspector notes: ${notes}` : null,
          ]
            .filter(Boolean)
            .join('\n\n'),
          severity,
          siteOrgUnitId,
        })
      }
    }
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: row.id,
      moduleKey: 'ppe',
      event: 'on_submit',
      occurrenceKey: row.id,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'ppe_inspection',
      entityId: row.id,
      action: 'create',
      summary: isOther
        ? `Recorded other PPE pre-use inspection — ${finalResult}`
        : `Recorded ${kindLabel} inspection — ${finalResult}`,
      after: {
        itemId,
        typeId,
        isOther,
        serialNumber,
        suppliedBy,
        kind,
        result: finalResult,
        siteOrgUnitId,
        criteriaCount: submissions.length,
        failedCriteriaCount: submissions.filter((submission) => submission.answer === 'fail')
          .length,
        photoCount: allPhotoIds.length,
        correctiveActionId,
      },
    })
    if (itemId) await materializePpeTypeEvidence(tx, ctx.tenantId, [typeId])
    return row.id
  })
  return { inspectionId, itemId }
}

export async function submitPpeInspection(formData: FormData): Promise<{ error: string } | void> {
  let recorded: Awaited<ReturnType<typeof recordPpeInspection>>
  try {
    recorded = await recordPpeInspection(formData)
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof ForbiddenError) {
      return {
        error:
          'You need Inspect PPE permission to record an inspection. Ask your administrator for access.',
      }
    }
    console.error('[ppe-inspection] submit failed', error)
    return {
      error: safeDbErrorMessage(error, 'Could not record the inspection. Please try again.'),
    }
  }
  revalidatePath('/ppe/inspections')
  if (recorded.itemId) {
    revalidatePath(`/ppe/${recorded.itemId}`)
    redirect(`/ppe/${recorded.itemId}?tab=inspections`)
  }
  revalidatePath('/ppe')
  const requested = String(formData.get('returnTo') ?? '')
  const returnTo = OTHER_RETURN_PATHS.has(requested) ? requested : '/ppe'
  redirect(`${returnTo}?drawer=inspection&inspectionId=${recorded.inspectionId}`)
}
