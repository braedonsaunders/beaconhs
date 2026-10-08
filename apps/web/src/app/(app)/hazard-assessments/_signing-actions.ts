'use server'

import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { assertCan } from '@beaconhs/tenant'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { activePeopleWhere, activeTenantUsersWhere } from '@beaconhs/db'
import {
  hazidAssessmentSignatures,
  people,
  crews,
  personGroups,
  personGroupMemberships,
  tenantUsers,
  tenantNotificationSettings,
  webpushSubscriptions,
} from '@beaconhs/db/schema'
import { recordDomainEvent, recordModuleFlowEvent } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'
import {
  freezeHazidSigning,
  lockHazidForSigning,
  requireOwnHazidSignature,
  MAX_SIGNING_CREW,
  SIGNING_REQUEST_DAYS,
  type SigningContext,
} from '@/lib/hazid-signing'
import { HazidSigningError, type SigningResult } from '@/lib/hazid-signing-result'
import { isUuid } from '@/lib/list-params'

async function signingContext(): Promise<SigningContext> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new HazidSigningError('Active tenant required')
  return ctx as SigningContext
}
function refresh(id: string) {
  revalidatePath(`/hazard-assessments/${id}`)
  revalidatePath('/hazard-assessments')
}

async function performAddSigningCrew(input: {
  assessmentId: string
  personIds: string[]
  groupId?: string
  crewId?: string
  externalNames: string[]
}) {
  const ctx = await signingContext()
  assertCan(ctx, 'hazid.update')
  if (
    !isUuid(input.assessmentId) ||
    !Array.isArray(input.personIds) ||
    input.personIds.length > MAX_SIGNING_CREW ||
    input.personIds.some((id) => !isUuid(id)) ||
    !Array.isArray(input.externalNames) ||
    input.externalNames.length > MAX_SIGNING_CREW
  )
    throw new HazidSigningError('Choose a valid crew')
  if (input.externalNames.some((name) => typeof name !== 'string' || name.trim().length > 200))
    throw new HazidSigningError('Signer names must be 200 characters or fewer')
  const result = await ctx.db(async (tx) => {
    const parent = await lockHazidForSigning(ctx, tx, input.assessmentId)
    const ids = new Set(input.personIds)
    if (input.groupId) {
      if (!isUuid(input.groupId)) throw new HazidSigningError('Group not found')
      const [group] = await tx
        .select({ id: personGroups.id })
        .from(personGroups)
        .where(and(eq(personGroups.id, input.groupId), isNull(personGroups.deletedAt)))
      if (!group) throw new HazidSigningError('Group not found')
      const members = await tx
        .select({ id: people.id })
        .from(personGroupMemberships)
        .innerJoin(
          people,
          and(
            eq(people.tenantId, personGroupMemberships.tenantId),
            eq(people.id, personGroupMemberships.personId),
          ),
        )
        .where(and(eq(personGroupMemberships.groupId, input.groupId), activePeopleWhere()))
        .limit(MAX_SIGNING_CREW + 1)
      for (const member of members) ids.add(member.id)
    }
    if (input.crewId) {
      if (!isUuid(input.crewId)) throw new HazidSigningError('Crew not found')
      const [crew] = await tx
        .select({ id: crews.id })
        .from(crews)
        .where(and(eq(crews.id, input.crewId)))
      if (!crew) throw new HazidSigningError('Crew not found')
      const members = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.crewId, input.crewId), activePeopleWhere()))
        .limit(MAX_SIGNING_CREW + 1)
      for (const member of members) ids.add(member.id)
    }
    if (ids.size > MAX_SIGNING_CREW)
      throw new HazidSigningError('A signing crew can contain up to 250 people')
    const selected = ids.size
      ? await tx
          .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
          .from(people)
          .where(
            and(
              eq(people.tenantId, ctx.tenantId),
              inArray(people.id, [...ids]),
              activePeopleWhere(),
            ),
          )
      : []
    if (selected.length !== ids.size)
      throw new HazidSigningError('Choose active people from this workspace')
    const existing = await tx
      .select()
      .from(hazidAssessmentSignatures)
      .where(
        and(
          eq(hazidAssessmentSignatures.assessmentId, parent.id),
          eq(hazidAssessmentSignatures.revision, parent.signingRevision),
        ),
      )
    const names = new Set(
      existing.flatMap((row) => (row.externalName ? [row.externalName.toLowerCase()] : [])),
    )
    const personIds = new Set(existing.flatMap((row) => (row.personId ? [row.personId] : [])))
    const externalNames: string[] = []
    for (const raw of input.externalNames) {
      const name = raw.trim()
      if (name && !names.has(name.toLowerCase())) {
        names.add(name.toLowerCase())
        externalNames.push(name)
      }
    }
    const rows = [
      ...selected
        .filter((p) => !personIds.has(p.id))
        .map((p) => ({
          tenantId: ctx.tenantId,
          assessmentId: parent.id,
          revision: parent.signingRevision,
          signatureType: 'internal' as const,
          personId: p.id,
          signerName: `${p.firstName} ${p.lastName}`,
        })),
      ...externalNames.map((name) => ({
        tenantId: ctx.tenantId,
        assessmentId: parent.id,
        revision: parent.signingRevision,
        signatureType: 'external' as const,
        externalName: name,
        signerName: name,
      })),
    ]
    if (existing.length + rows.length > MAX_SIGNING_CREW)
      throw new HazidSigningError('A signing crew can contain up to 250 people')
    if (!rows.length)
      throw new HazidSigningError('Choose people who are not already on the signing crew')
    await tx.insert(hazidAssessmentSignatures).values(rows)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: parent.id,
      action: 'update',
      summary: `Added ${rows.length} crew members for signing`,
    })
    return rows.length
  })
  refresh(input.assessmentId)
  return result
}

async function performStartSigningCollection(assessmentId: string, preferredSignatureId?: string) {
  const ctx = await signingContext()
  assertCan(ctx, 'hazid.update')
  if (!isUuid(assessmentId)) throw new HazidSigningError('Assessment not found')
  const result = await ctx.db(async (tx) => {
    const parent = await lockHazidForSigning(ctx, tx, assessmentId)
    if (preferredSignatureId && !isUuid(preferredSignatureId))
      throw new HazidSigningError('Signature not found')
    const [preferred] = preferredSignatureId
      ? await tx
          .select()
          .from(hazidAssessmentSignatures)
          .where(
            and(
              eq(hazidAssessmentSignatures.assessmentId, assessmentId),
              eq(hazidAssessmentSignatures.id, preferredSignatureId),
            ),
          )
          .limit(1)
      : []
    const [crew] = await tx
      .select({ id: hazidAssessmentSignatures.id })
      .from(hazidAssessmentSignatures)
      .where(
        and(
          eq(hazidAssessmentSignatures.assessmentId, assessmentId),
          eq(hazidAssessmentSignatures.revision, parent.signingRevision),
        ),
      )
      .limit(1)
    if (!crew) throw new HazidSigningError('Add the crew before collecting signatures')
    await freezeHazidSigning(ctx, tx, parent)
    if (!parent.signingFrozenAt)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'hazid_assessment',
        entityId: parent.id,
        action: 'update',
        summary: `Started signing revision ${parent.signingRevision}`,
      })
    const rows = await tx
      .select({
        id: hazidAssessmentSignatures.id,
        name: hazidAssessmentSignatures.signerName,
        personId: hazidAssessmentSignatures.personId,
        person: people,
      })
      .from(hazidAssessmentSignatures)
      .leftJoin(people, eq(people.id, hazidAssessmentSignatures.personId))
      .where(
        and(
          eq(hazidAssessmentSignatures.assessmentId, assessmentId),
          eq(hazidAssessmentSignatures.revision, parent.signingRevision),
          isNull(hazidAssessmentSignatures.signatureAttachmentId),
        ),
      )
      .orderBy(hazidAssessmentSignatures.createdAt, hazidAssessmentSignatures.id)
      .limit(MAX_SIGNING_CREW)
    if (preferred)
      rows.sort(
        (a, b) =>
          Number(
            b.personId ? b.personId === preferred.personId : b.name === preferred.externalName,
          ) -
          Number(
            a.personId ? a.personId === preferred.personId : a.name === preferred.externalName,
          ),
      )
    return {
      revision: parent.signingRevision,
      signers: rows
        .filter((r) => !r.personId || (r.person?.status === 'active' && !r.person.deletedAt))
        .map((r) => ({ id: r.id, name: r.name ?? 'Crew member' })),
    }
  })
  refresh(assessmentId)
  return result
}

async function captureSignature(
  signatureId: string,
  revision: number,
  ink: string,
  reviewed: boolean,
  own: boolean,
) {
  const ctx = await signingContext()
  if (!own) assertCan(ctx, 'hazid.update')
  if (
    !isUuid(signatureId) ||
    !Number.isInteger(revision) ||
    typeof ink !== 'string' ||
    !ink ||
    ink.length > 1_500_000 ||
    (own && reviewed !== true)
  )
    throw new HazidSigningError('Review the assessment and capture a signature')
  const assessmentId = await ctx.db(async (tx) => {
    if (own) return (await requireOwnHazidSignature(ctx, tx, signatureId)).assessment.id
    const [found] = await tx
      .select({ assessmentId: hazidAssessmentSignatures.assessmentId })
      .from(hazidAssessmentSignatures)
      .where(
        and(
          eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
          eq(hazidAssessmentSignatures.id, signatureId),
        ),
      )
      .limit(1)
    if (!found) throw new HazidSigningError('Signature not found')
    return found.assessmentId
  })
  await withStoredSignatureAttachment(ctx, ink, async (tx, attachmentId) => {
    const parent = await lockHazidForSigning(ctx, tx, assessmentId, own ? signatureId : undefined)
    if (!parent.signingFrozenAt || parent.signingRevision !== revision)
      throw new HazidSigningError(
        'The assessment changed. Open the current signing revision before signing.',
      )
    const [slot] = await tx
      .select({
        personId: hazidAssessmentSignatures.personId,
        name: hazidAssessmentSignatures.signerName,
      })
      .from(hazidAssessmentSignatures)
      .where(
        and(
          eq(hazidAssessmentSignatures.id, signatureId),
          eq(hazidAssessmentSignatures.assessmentId, assessmentId),
          eq(hazidAssessmentSignatures.revision, revision),
        ),
      )
      .limit(1)
    if (!slot) throw new HazidSigningError('Signature not found')
    if (slot.personId) {
      const [active] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, slot.personId), activePeopleWhere()))
        .limit(1)
      if (!active)
        throw new HazidSigningError('This person is no longer active. Remove them from the crew.')
    }
    const [updated] = await tx
      .update(hazidAssessmentSignatures)
      .set({ signatureAttachmentId: attachmentId, signedAt: new Date() })
      .where(
        and(
          eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
          eq(hazidAssessmentSignatures.id, signatureId),
          eq(hazidAssessmentSignatures.assessmentId, assessmentId),
          eq(hazidAssessmentSignatures.revision, revision),
          isNull(hazidAssessmentSignatures.signatureAttachmentId),
        ),
      )
      .returning({ id: hazidAssessmentSignatures.id })
    if (!updated) throw new HazidSigningError('This signer has already signed')
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: assessmentId,
      moduleKey: 'hazid',
      event: 'on_sign',
      occurrenceKey: `${updated.id}:${attachmentId}`,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      action: 'sign',
      summary: `${slot.name ?? 'Crew member'} signed`,
      after: { signer: slot.name, signatureAttachmentId: attachmentId },
      metadata: {
        signatureId: updated.id,
        revision,
        review: own ? 'individual' : 'group',
        method: own ? 'own_device' : 'shared_device',
      },
    })
    if (parent.locked)
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'hazard_assessment',
        targetRef: {},
      })
  })
  refresh(assessmentId)
}

async function performRequestCrewSignatures(assessmentId: string) {
  const ctx = await signingContext()
  assertCan(ctx, 'hazid.update')
  if (!isUuid(assessmentId)) throw new HazidSigningError('Assessment not found')
  const result = await ctx.db(async (tx) => {
    const parent = await lockHazidForSigning(ctx, tx, assessmentId)
    const [config] = await tx
      .select()
      .from(tenantNotificationSettings)
      .where(
        and(
          eq(tenantNotificationSettings.tenantId, ctx.tenantId),
          eq(tenantNotificationSettings.category, 'hazid_signing'),
        ),
      )
      .limit(1)
    if (config?.enabled === false)
      throw new HazidSigningError(
        'Hazard assessment signing notifications are disabled in tenant settings',
      )
    const rows = await tx
      .select({ signature: hazidAssessmentSignatures, person: people, member: tenantUsers })
      .from(hazidAssessmentSignatures)
      .leftJoin(
        people,
        and(
          eq(people.tenantId, hazidAssessmentSignatures.tenantId),
          eq(people.id, hazidAssessmentSignatures.personId),
        ),
      )
      .leftJoin(
        tenantUsers,
        and(
          eq(tenantUsers.tenantId, people.tenantId),
          eq(tenantUsers.userId, people.userId),
          activeTenantUsersWhere(),
        ),
      )
      .where(
        and(
          eq(hazidAssessmentSignatures.assessmentId, parent.id),
          eq(hazidAssessmentSignatures.revision, parent.signingRevision),
          isNull(hazidAssessmentSignatures.signatureAttachmentId),
        ),
      )
    const eligible = rows.filter(
      (r) =>
        r.person?.status === 'active' &&
        !r.person.deletedAt &&
        r.member &&
        (!r.signature.requestedAt || Date.now() - r.signature.requestedAt.getTime() >= 60_000),
    )
    if (!eligible.length)
      throw new HazidSigningError(
        'No unsigned active crew members with linked accounts are ready for a request. Wait one minute before resending.',
      )
    await freezeHazidSigning(ctx, tx, parent)
    const subscriptions = await tx
      .select({ userId: webpushSubscriptions.userId })
      .from(webpushSubscriptions)
      .where(
        and(
          eq(webpushSubscriptions.tenantId, ctx.tenantId),
          inArray(
            webpushSubscriptions.userId,
            eligible.map((r) => r.member!.userId),
          ),
        ),
      )
    const subscribed = new Set(subscriptions.map((s) => s.userId))
    for (const row of eligible) {
      const requestId = randomUUID(),
        now = new Date(),
        expires = new Date(now.getTime() + SIGNING_REQUEST_DAYS * 86400_000)
      await tx
        .update(hazidAssessmentSignatures)
        .set({ requestId, requestedAt: now, requestExpiresAt: expires })
        .where(eq(hazidAssessmentSignatures.id, row.signature.id))
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'hazid.signature_requested',
        subjectId: parent.id,
        dedupKey: `hazid.signature_requested:${requestId}`,
        payload: {
          notification: {
            kind: 'hazid_signature_requested',
            assessmentId: parent.id,
            signatureId: row.signature.id,
            requestId,
          },
        },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: parent.id,
      action: 'update',
      summary: `Requested ${eligible.length} crew signatures for revision ${parent.signingRevision}`,
      metadata: { revision: parent.signingRevision, recipientCount: eligible.length },
    })
    return {
      requested: eligible.length,
      skipped: rows.length - eligible.length,
      withoutPush: eligible.filter((r) => !subscribed.has(r.member!.userId)).length,
    }
  })
  refresh(assessmentId)
  return result
}

async function performChangeSignature(
  input: { assessmentId: string; signatureId: string; revision: number; signedAt: string | null },
  remove: boolean,
) {
  const ctx = await signingContext()
  assertCan(ctx, 'hazid.update')
  if (
    !isUuid(input.assessmentId) ||
    !isUuid(input.signatureId) ||
    !Number.isInteger(input.revision) ||
    input.revision < 1 ||
    (input.signedAt !== null &&
      (typeof input.signedAt !== 'string' || !Number.isFinite(Date.parse(input.signedAt))))
  )
    throw new HazidSigningError('Choose a valid signature')
  await ctx.db(async (tx) => {
    const parent = await lockHazidForSigning(ctx, tx, input.assessmentId)
    if (parent.signingRevision !== input.revision)
      throw new HazidSigningError('The assessment changed. Refresh the crew before continuing.')
    const predicate = and(
      eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
      eq(hazidAssessmentSignatures.id, input.signatureId),
      eq(hazidAssessmentSignatures.assessmentId, input.assessmentId),
      eq(hazidAssessmentSignatures.revision, input.revision),
    )
    const [signature] = await tx
      .select({
        signerName: hazidAssessmentSignatures.signerName,
        signatureAttachmentId: hazidAssessmentSignatures.signatureAttachmentId,
        signedAt: hazidAssessmentSignatures.signedAt,
      })
      .from(hazidAssessmentSignatures)
      .where(predicate)
      .for('update')
      .limit(1)
    if (!signature) throw new HazidSigningError('Signature not found')
    if ((signature.signedAt?.toISOString() ?? null) !== input.signedAt)
      throw new HazidSigningError('The signature changed. Refresh the crew before continuing.')
    if (remove) {
      await tx.delete(hazidAssessmentSignatures).where(predicate)
    } else {
      if (!signature.signatureAttachmentId)
        throw new HazidSigningError('This signature is already clear')
      await tx
        .update(hazidAssessmentSignatures)
        .set({
          signatureAttachmentId: null,
          signedAt: null,
          requestId: null,
          requestedAt: null,
          requestExpiresAt: null,
        })
        .where(predicate)
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'hazid_assessment',
      entityId: input.assessmentId,
      action: remove ? 'delete' : 'update',
      summary: remove ? 'Removed crew member' : 'Cleared crew signature',
      before: {
        signer: signature.signerName,
        signatureAttachmentId: signature.signatureAttachmentId,
        signedAt: signature.signedAt?.toISOString() ?? null,
      },
      metadata: { signatureId: input.signatureId, revision: input.revision },
    })
    if (parent.locked)
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'hazard_assessment',
        targetRef: {},
      })
  })
  refresh(input.assessmentId)
}

async function signingResult<T>(run: () => Promise<T>): Promise<SigningResult<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof HazidSigningError) return { ok: false, error: error.message }
    console.error('[hazid-signing] action failed', error)
    return {
      ok: false,
      error:
        'Could not save the signing change. Your work was not reported as complete. Try again.',
    }
  }
}
export async function addSigningCrew(input: Parameters<typeof performAddSigningCrew>[0]) {
  return signingResult(() => performAddSigningCrew(input))
}
export async function startSigningCollection(assessmentId: string, preferredSignatureId?: string) {
  return signingResult(() => performStartSigningCollection(assessmentId, preferredSignatureId))
}
export async function requestCrewSignatures(assessmentId: string) {
  return signingResult(() => performRequestCrewSignatures(assessmentId))
}
export async function signCrewMember(signatureId: string, revision: number, ink: string) {
  return signingResult(() => captureSignature(signatureId, revision, ink, false, false))
}
export async function signOwnAssessment(
  signatureId: string,
  revision: number,
  ink: string,
  reviewed: boolean,
) {
  return signingResult(() => captureSignature(signatureId, revision, ink, reviewed, true))
}

export async function clearCrewSignature(input: Parameters<typeof performChangeSignature>[0]) {
  return signingResult(() => performChangeSignature(input, false))
}
export async function removeSigningCrew(input: Parameters<typeof performChangeSignature>[0]) {
  return signingResult(() => performChangeSignature(input, true))
}
