// Shared helpers for the PPE module.
//
// What lives here:
//   - shouldSpawnCorrectiveAction(): the severity-threshold guard
//   - spawnCorrectiveActionForFailedInspection(): mints + audits the CA
//   - issuePpeToPerson() / returnPpeFromPerson() / discardPpe() / replacePpe(): the
//     four issuance transactions, each one inserts the ledger row AND
//     mutates the item state in the same tx
//
// We keep these in a server-only module so that every place in the UI that
// touches a PPE item lifecycle goes through the same hardened path.

import { and, count, eq, sql } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  correctiveActions,
  ppeAnnualRecords,
  ppeInspections,
  ppeIssues,
  ppeItems,
  ppeTypes,
  ppeTypeInspectionCriteria,
} from '@beaconhs/db/schema'
import { recordAudit } from '@/lib/audit'

export type PpeInspectionKind = 'pre_use' | 'annual'
export type PpeCriterionAnswer = 'pass' | 'fail' | 'n_a'
export type PpeSeverity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Spec: severity ≥ high on a fail → spawn a CA. Same rule as inspections.
 */
export function shouldSpawnCorrectiveAction(
  answer: PpeCriterionAnswer | null,
  severity: PpeSeverity | null,
): boolean {
  return answer === 'fail' && (severity === 'high' || severity === 'critical')
}

/**
 * Given a PPE inspection row that failed (overall result, or one of the
 * per-criterion answers), spawn a corrective action and audit it.
 *
 * We assume the caller already determined that a CA is warranted. The CA
 * `source` is 'inspection' and we set the source_entity link back to the
 * ppe_inspections row id so the CA detail page can render the back-link.
 *
 * Returns the new CA id, or null if a CA could not be created (e.g. tenant
 * caps).
 */
export async function spawnCorrectiveActionForFailedPpeInspection(
  ctx: RequestContext,
  args: {
    inspectionId: string
    itemId: string
    title: string
    description: string
    severity: PpeSeverity
    siteOrgUnitId?: string | null
  },
): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10)
  const dayOffset = args.severity === 'critical' ? 1 : args.severity === 'high' ? 3 : 7
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + dayOffset)
  const dueOn = dueDate.toISOString().slice(0, 10)
  const caId = await ctx.db(async (tx) => {
    const year = new Date().getFullYear()
    const [tally] = await tx
      .select({ n: count() })
      .from(correctiveActions)
      .where(
        sql`extract(year from coalesce(${correctiveActions.assignedOn}, current_date)) = ${year}`,
      )
    const reference = `CA-${year}-${String(Number(tally?.n ?? 0) + 1).padStart(4, '0')}`

    const [ca] = await tx
      .insert(correctiveActions)
      .values({
        tenantId: ctx.tenantId,
        reference,
        title: args.title,
        description: args.description,
        severity: args.severity,
        status: 'open',
        source: 'inspection',
        sourceEntityType: 'ppe_inspection',
        sourceEntityId: args.inspectionId,
        siteOrgUnitId: args.siteOrgUnitId ?? null,
        assignedOn: today,
        dueOn,
        assignedByTenantUserId: ctx.membership?.id ?? null,
        ownerTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: correctiveActions.id })
    return ca?.id ?? null
  })
  if (!caId) return null
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: caId,
    action: 'create',
    summary: `Auto-spawned CA from failed PPE inspection (severity ${args.severity})`,
    after: { source: 'ppe_inspection', inspectionId: args.inspectionId, itemId: args.itemId },
  })
  return caId
}

/**
 * The four issuance actions all funnel through this helper so that the ledger
 * row + the item state mutation happen atomically. The caller is expected to
 * have already validated the inputs (e.g. holder exists, item not discarded).
 */
export async function recordPpeIssueAction(
  ctx: RequestContext,
  args: {
    itemId: string
    personId: string | null
    action: 'issue' | 'return' | 'replace' | 'mark_damaged' | 'discard'
    note?: string | null
  },
): Promise<{ issueId: string | null }> {
  const issueId = await ctx.db(async (tx) => {
    const [iss] = await tx
      .insert(ppeIssues)
      .values({
        tenantId: ctx.tenantId,
        itemId: args.itemId,
        personId: args.personId,
        action: args.action,
        quantity: 1,
        issuedByTenantUserId: ctx.membership?.id ?? '',
        note: args.note ?? null,
      })
      .returning({ id: ppeIssues.id })

    // Apply the side-effect on the item itself.
    if (args.action === 'issue' || args.action === 'replace') {
      await tx
        .update(ppeItems)
        .set({ status: 'issued', currentHolderPersonId: args.personId ?? null })
        .where(eq(ppeItems.id, args.itemId))
    } else if (args.action === 'return') {
      await tx
        .update(ppeItems)
        .set({ status: 'returned', currentHolderPersonId: null })
        .where(eq(ppeItems.id, args.itemId))
    } else if (args.action === 'mark_damaged') {
      await tx.update(ppeItems).set({ status: 'damaged' }).where(eq(ppeItems.id, args.itemId))
    } else if (args.action === 'discard') {
      await tx
        .update(ppeItems)
        .set({ status: 'discarded', currentHolderPersonId: null })
        .where(eq(ppeItems.id, args.itemId))
    }
    return iss?.id ?? null
  })
  await recordAudit(ctx, {
    entityType: 'ppe_item',
    entityId: args.itemId,
    action: 'update',
    summary:
      args.action === 'issue'
        ? 'Issued PPE to holder'
        : args.action === 'return'
          ? 'Returned PPE'
          : args.action === 'replace'
            ? 'Replaced PPE'
            : args.action === 'mark_damaged'
              ? 'Marked PPE damaged'
              : 'Discarded PPE',
    after: { action: args.action, personId: args.personId ?? null, note: args.note ?? null },
  })
  return { issueId }
}

/**
 * Look up the criteria catalog for a PPE type filtered by inspection kind.
 * Sorted by entityOrder so the on-screen render order matches the admin
 * configuration.
 */
export async function loadInspectionCriteriaForType(
  ctx: RequestContext,
  typeId: string,
  kind: PpeInspectionKind,
): Promise<
  {
    id: string
    question: string
    description: string | null
    severity: PpeSeverity
    requiresPhoto: boolean
    entityOrder: number
  }[]
> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(ppeTypeInspectionCriteria)
      .where(
        and(
          eq(ppeTypeInspectionCriteria.ppeTypeId, typeId),
          eq(ppeTypeInspectionCriteria.inspectionKind, kind),
        ),
      )
      .orderBy(ppeTypeInspectionCriteria.entityOrder)
    return rows.map((r) => ({
      id: r.id,
      question: r.question,
      description: r.description,
      severity: r.severity as PpeSeverity,
      requiresPhoto: r.requiresPhoto,
      entityOrder: r.entityOrder,
    }))
  })
}

/**
 * Convenience compute — how many days until the next inspection / expiry,
 * negative if overdue. Used by the reports tab and the dashboard tiles.
 */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

/**
 * Tag for the per-item annual-record year column — defaults to the year of the
 * inspectedOn date.
 */
export function deriveAnnualYear(inspectedOn: string): string {
  return String(new Date(inspectedOn).getFullYear())
}

// Re-export the schema imports so callers can do `from '@/app/(app)/ppe/_lib'`
// without having to also import the schema barrel in components that only
// touch the helpers above.
export {
  ppeAnnualRecords,
  ppeInspections,
  ppeIssues,
  ppeItems,
  ppeTypeInspectionCriteria,
  ppeTypes,
}
