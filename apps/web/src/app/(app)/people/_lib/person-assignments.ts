// A person's group memberships and job-title assignments, written from the
// inline Groups / Titles / Primary job title fields on the person page (via
// the people record saver, see ../_record-edits.ts). Each function runs inside
// the caller's transaction and expects the caller to have already taken the
// person-group membership graph lock, locked the person row FOR UPDATE, and
// refused sync-owned relationships. Validation failures throw
// `RecordEditRejection`, so only the edited field is refused.

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  personGroupMemberships,
  personGroups,
  personTitleAssignments,
  personTitles,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  lockJobTitleObligations,
  materializeLockedJobTitleObligations,
} from '@/lib/job-title-compliance'
import { refreshPersonGroupCache } from '@/lib/person-group-memberships'
import { RecordEditRejection } from '@/lib/record-sync/edits'

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Rebuild the denormalised `people.title_ids` cache after an assignment change. */
export async function refreshPersonTitleCache(
  tx: Database,
  tenantId: string,
  personIds: string[],
): Promise<void> {
  if (personIds.length === 0) return
  await tx.execute(sql`
    UPDATE people
    SET title_ids = COALESCE((
      SELECT jsonb_agg(title_id ORDER BY title_id)
      FROM person_title_assignments
      WHERE person_id = people.id AND tenant_id = ${tenantId}
    ), '[]'::jsonb)
    WHERE id IN (${sql.join(
      personIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND tenant_id = ${tenantId}
  `)
}

/**
 * Set a person's full group membership set: diff against the current
 * memberships, add/remove the delta, refresh the denormalised cache, audit.
 */
export async function setPersonGroupMemberships(
  tx: Database,
  ctx: RequestContext,
  personId: string,
  selectedIds: readonly string[],
): Promise<void> {
  const groupIds = [...new Set(selectedIds)].sort(byId)
  if (groupIds.length > 0) {
    const selectedGroups = await tx
      .select({ id: personGroups.id })
      .from(personGroups)
      .where(
        and(
          eq(personGroups.tenantId, ctx.tenantId),
          inArray(personGroups.id, groupIds),
          isNull(personGroups.deletedAt),
        ),
      )
      .orderBy(asc(personGroups.id))
      .for('key share')
    if (selectedGroups.length !== groupIds.length) {
      throw new RecordEditRejection('One or more selected groups are unavailable')
    }
  }
  const existing = await tx
    .select({ groupId: personGroupMemberships.groupId })
    .from(personGroupMemberships)
    .where(
      and(
        eq(personGroupMemberships.tenantId, ctx.tenantId),
        eq(personGroupMemberships.personId, personId),
      ),
    )
    .orderBy(asc(personGroupMemberships.groupId))
    .for('update')
  const existingIds = existing.map((r) => r.groupId)
  const toRemove = existingIds.filter((g) => !groupIds.includes(g))
  const toAdd = groupIds.filter((g) => !existingIds.includes(g))
  if (toRemove.length > 0) {
    await tx
      .delete(personGroupMemberships)
      .where(
        and(
          eq(personGroupMemberships.tenantId, ctx.tenantId),
          eq(personGroupMemberships.personId, personId),
          inArray(personGroupMemberships.groupId, toRemove),
        ),
      )
  }
  if (toAdd.length > 0) {
    await tx
      .insert(personGroupMemberships)
      .values(toAdd.map((groupId) => ({ tenantId: ctx.tenantId, groupId, personId })))
      .onConflictDoNothing()
  }
  await refreshPersonGroupCache(tx, ctx.tenantId, [personId])
  if (toAdd.length > 0 || toRemove.length > 0) {
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person',
      entityId: personId,
      action: 'update',
      summary: 'Updated group memberships',
      before: { groupIds: existingIds },
      after: { groupIds },
    })
  }
}

/**
 * Set a person's full set of held titles: diff against the current
 * assignments, add/remove the delta, and guarantee exactly one primary
 * survives whenever the person still holds at least one title.
 */
export async function setPersonTitleAssignments(
  tx: Database,
  ctx: RequestContext,
  personId: string,
  selectedIds: readonly string[],
): Promise<void> {
  const titleIds = [...new Set(selectedIds)]
  const selectedTitles =
    titleIds.length > 0
      ? await tx
          .select({ id: personTitles.id })
          .from(personTitles)
          .where(and(inArray(personTitles.id, titleIds), isNull(personTitles.deletedAt)))
          .for('key share')
      : []
  if (selectedTitles.length !== titleIds.length) {
    throw new RecordEditRejection('One or more selected titles are unavailable')
  }

  const existing = await tx
    .select()
    .from(personTitleAssignments)
    .where(eq(personTitleAssignments.personId, personId))
  const existingIds = existing.map((row) => row.titleId)
  const lockedObligations = await lockJobTitleObligations(tx, ctx.tenantId, [
    ...existingIds,
    ...titleIds,
  ])
  if (existing.length > 0) {
    // No active crosswalk owns this person. Complete any historical/removed
    // connection handoff before applying the user's full manual selection.
    await tx
      .update(personTitleAssignments)
      .set({ isManuallyMaintained: true, sourceConnectionId: null })
      .where(eq(personTitleAssignments.personId, personId))
  }
  const toRemove = existingIds.filter((t) => !titleIds.includes(t))
  const toAdd = titleIds.filter((t) => !existingIds.includes(t))
  if (toRemove.length > 0) {
    await tx
      .delete(personTitleAssignments)
      .where(
        and(
          eq(personTitleAssignments.personId, personId),
          inArray(personTitleAssignments.titleId, toRemove),
        ),
      )
  }
  if (toAdd.length > 0) {
    await tx
      .insert(personTitleAssignments)
      .values(toAdd.map((titleId) => ({ tenantId: ctx.tenantId, titleId, personId })))
      .onConflictDoNothing()
  }
  // Keep the primary invariant. If the previous primary was removed, choose
  // by canonical title name so form order and insertion timing cannot change
  // which title becomes primary.
  const remaining = await tx
    .select({ assignment: personTitleAssignments, titleName: personTitles.name })
    .from(personTitleAssignments)
    .innerJoin(personTitles, eq(personTitles.id, personTitleAssignments.titleId))
    .where(eq(personTitleAssignments.personId, personId))
    .orderBy(asc(personTitles.name), asc(personTitleAssignments.titleId))
  if (remaining.length > 0 && !remaining.some((r) => r.assignment.isPrimary)) {
    await tx
      .update(personTitleAssignments)
      .set({ isPrimary: true })
      .where(
        and(
          eq(personTitleAssignments.personId, personId),
          eq(personTitleAssignments.titleId, remaining[0]!.assignment.titleId),
        ),
      )
  }
  await refreshPersonTitleCache(tx, ctx.tenantId, [personId])
  await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedObligations)
  const primary = remaining.find((row) => row.assignment.isPrimary) ?? remaining[0] ?? null
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'update',
    summary: 'Updated title assignments',
    before: {
      titleIds: [...existingIds].sort(),
      primaryTitleId: existing.find((row) => row.isPrimary)?.titleId ?? null,
    },
    after: {
      titleIds: remaining.map((row) => row.assignment.titleId).sort(),
      primaryTitleId: primary?.assignment.titleId ?? null,
    },
  })
}

/**
 * Set the single title used anywhere a person needs one display/search title.
 * Selecting an unheld title also adds it to the person's held-title set.
 */
export async function setPrimaryPersonTitleAssignment(
  tx: Database,
  ctx: RequestContext,
  personId: string,
  titleId: string | null,
): Promise<void> {
  const existing = await tx
    .select()
    .from(personTitleAssignments)
    .where(eq(personTitleAssignments.personId, personId))
  const beforePrimaryTitleId = existing.find((row) => row.isPrimary)?.titleId ?? null

  if (!titleId) {
    if (existing.length > 0) {
      throw new RecordEditRejection('Choose a primary job title while this person holds titles')
    }
    return
  }

  const [title] = await tx
    .select({ id: personTitles.id })
    .from(personTitles)
    .where(and(eq(personTitles.id, titleId), isNull(personTitles.deletedAt)))
    .limit(1)
    .for('key share')
  if (!title) throw new RecordEditRejection('Selected title is unavailable')

  const lockedObligations = await lockJobTitleObligations(tx, ctx.tenantId, [titleId])
  if (existing.length > 0) {
    await tx
      .update(personTitleAssignments)
      .set({ isManuallyMaintained: true, sourceConnectionId: null })
      .where(eq(personTitleAssignments.personId, personId))
  }

  await tx
    .insert(personTitleAssignments)
    .values({ tenantId: ctx.tenantId, personId, titleId, isPrimary: false })
    .onConflictDoNothing()
  await tx
    .update(personTitleAssignments)
    .set({ isPrimary: false })
    .where(eq(personTitleAssignments.personId, personId))
  await tx
    .update(personTitleAssignments)
    .set({ isPrimary: true })
    .where(
      and(
        eq(personTitleAssignments.personId, personId),
        eq(personTitleAssignments.titleId, titleId),
      ),
    )
  await refreshPersonTitleCache(tx, ctx.tenantId, [personId])
  await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedObligations)
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'update',
    summary: 'Updated primary job title',
    before: { primaryTitleId: beforePrimaryTitleId },
    after: { primaryTitleId: titleId },
  })
}
