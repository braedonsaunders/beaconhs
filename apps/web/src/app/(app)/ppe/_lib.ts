// Shared helpers for the PPE module.
//
// What lives here:
//   - shouldSpawnCorrectiveAction(): the severity-threshold guard
//   - createCorrectiveActionForFailedPpeInspection(): mints + audits the CA
//   - recordPpeIssueAction() / applyPpeStatusTransition(): the single path for
//     every status change, writing the ledger row, the item state, and the
//     who/when attribution in one transaction
//
// We keep these in a server-only module so that every place in the UI that
// touches a PPE item lifecycle goes through the same hardened path.

import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import {
  correctiveActions,
  ppeIssues,
  ppeItems,
  ppeTypeCriteriaGroups,
  ppeTypeInspectionCriteria,
} from '@beaconhs/db/schema'
import { recordAuditInTransaction } from '@/lib/audit'
import { nextReference } from '@/lib/reference'

type PpeInspectionKind = 'pre_use' | 'annual'
type PpeCriterionAnswer = 'pass' | 'fail' | 'n_a'
type PpeSeverity = 'low' | 'medium' | 'high' | 'critical'

// Unique indexes we translate into user-facing messages. Naming them keeps a
// collision on some *other* index from being reported as the wrong problem.
export const PPE_SERIAL_UNIQUE_CONSTRAINT = 'ppe_items_tenant_serial_ux'
export const PPE_ANNUAL_RECORD_YEAR_UNIQUE_CONSTRAINT = 'ppe_annual_records_item_year_ux'

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
 * Uses the caller's transaction so the inspection, evidence, CA, and audit
 * trail either all commit or all roll back.
 */
export async function createCorrectiveActionForFailedPpeInspection(
  tx: Database,
  ctx: RequestContext,
  args: {
    inspectionId: string
    itemId: string
    title: string
    description: string
    severity: PpeSeverity
    siteOrgUnitId?: string | null
  },
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10)
  const dayOffset = args.severity === 'critical' ? 1 : args.severity === 'high' ? 3 : 7
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + dayOffset)
  const dueOn = dueDate.toISOString().slice(0, 10)
  const reference = await nextReference(tx, ctx.tenantId, 'corrective_action')

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
  if (!ca) throw new Error('Corrective action could not be created')
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'corrective_action',
    entityId: ca.id,
    action: 'create',
    summary: `Auto-spawned CA from failed PPE inspection (severity ${args.severity})`,
    after: { source: 'ppe_inspection', inspectionId: args.inspectionId, itemId: args.itemId },
  })
  await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
    sourceModule: 'corrective_action',
    targetRef: {},
  })
  return ca.id
}

type PpeLedgerAction =
  | 'issue'
  | 'return'
  | 'replace'
  | 'mark_out_of_service'
  | 'return_to_service'
  | 'return_to_stock'
  | 'expire'
  | 'discard'

/** The item state each ledger action lands the item in. */
const STATUS_AFTER: Record<
  PpeLedgerAction,
  'in_stock' | 'issued' | 'returned' | 'out_of_service' | 'discarded' | 'expired'
> = {
  issue: 'issued',
  replace: 'issued',
  return: 'returned',
  mark_out_of_service: 'out_of_service',
  // Cleared items go back to their holder when they still have one; the
  // holder is preserved through the out-of-service period.
  return_to_service: 'issued',
  return_to_stock: 'in_stock',
  expire: 'expired',
  discard: 'discarded',
}

const AUDIT_SUMMARY: Record<PpeLedgerAction, string> = {
  issue: 'Issued PPE to holder',
  return: 'Returned PPE',
  replace: 'Replaced PPE',
  mark_out_of_service: 'Took PPE out of service',
  return_to_service: 'Returned PPE to service',
  return_to_stock: 'Returned PPE to stock',
  expire: 'Marked PPE expired',
  discard: 'Discarded PPE',
}

type PpeStatusTransitionArgs = {
  itemId: string
  personId: string | null
  action: PpeLedgerAction
  note?: string | null
  /** Back-dated issue date. Defaults to now. */
  occurredAt?: Date | null
}

/**
 * EVERY PPE status change funnels through here so the ledger row, the item
 * state, and the who/when attribution are written atomically. Nothing should
 * call `update(ppeItems).set({ status })` directly — a status that changes
 * without a ledger row is invisible in History and unattributable.
 */
export async function recordPpeIssueAction(
  ctx: RequestContext,
  args: PpeStatusTransitionArgs,
): Promise<{ issueId: string | null }> {
  const issueId = await ctx.db((tx) => applyPpeStatusTransition(tx, ctx, args))
  return { issueId }
}

/**
 * Transaction-scoped form, for callers that already hold a tx and need the
 * status change to commit atomically with their own writes (e.g. recording an
 * inspection that fails the item out of service).
 */
export async function applyPpeStatusTransition(
  tx: Database,
  ctx: RequestContext,
  args: PpeStatusTransitionArgs,
): Promise<string | null> {
  // The ledger row is attributed to a tenant user (NOT NULL FK). A super-admin
  // viewing a tenant has no membership, so refuse with a clear error instead of
  // letting Postgres reject an empty uuid.
  const issuedByTenantUserId =
    ctx.membership?.id && ctx.membership.id !== 'super-admin' ? ctx.membership.id : null
  if (!issuedByTenantUserId) {
    throw new Error('Super-admin cannot change PPE custody — switch to a tenant user.')
  }
  {
    const [item] = await tx
      .select({
        id: ppeItems.id,
        typeId: ppeItems.typeId,
        status: ppeItems.status,
        currentHolderPersonId: ppeItems.currentHolderPersonId,
        deletedAt: ppeItems.deletedAt,
      })
      .from(ppeItems)
      .where(eq(ppeItems.id, args.itemId))
      .limit(1)
      .for('update')
    if (!item || item.deletedAt) throw new Error('PPE item was not found.')
    const isIssuing = args.action === 'issue' || args.action === 'replace'
    if (isIssuing && (item.status === 'discarded' || item.status === 'expired')) {
      throw new Error('Discarded or expired PPE cannot be issued.')
    }
    if (isIssuing && item.status === 'out_of_service') {
      throw new Error(
        'This PPE is out of service. It must pass a return-to-service inspection before it can be issued.',
      )
    }
    if (isIssuing && !args.personId) {
      throw new Error('Select a holder before issuing PPE.')
    }
    if (args.action === 'return_to_service' && item.status !== 'out_of_service') {
      throw new Error('Only out-of-service PPE can be returned to service.')
    }
    const occurredAt = args.occurredAt ?? new Date()
    const [iss] = await tx
      .insert(ppeIssues)
      .values({
        tenantId: ctx.tenantId,
        itemId: args.itemId,
        personId: args.personId,
        action: args.action,
        quantity: 1,
        issuedByTenantUserId,
        occurredAt,
        note: args.note ?? null,
      })
      .returning({ id: ppeIssues.id })

    // Apply the side-effect on the item itself. Only these transitions clear
    // the holder: an item taken out of service stays physically with the
    // person who has it, so its holder is deliberately preserved.
    const clearsHolder =
      args.action === 'return' || args.action === 'discard' || args.action === 'return_to_stock'
    const status =
      args.action === 'return_to_service' && !item.currentHolderPersonId
        ? 'in_stock'
        : STATUS_AFTER[args.action]
    await tx
      .update(ppeItems)
      .set({
        status,
        ...(isIssuing ? { currentHolderPersonId: args.personId ?? null } : {}),
        ...(clearsHolder ? { currentHolderPersonId: null } : {}),
        statusChangedAt: occurredAt,
        statusChangedByTenantUserId: issuedByTenantUserId,
      })
      .where(eq(ppeItems.id, args.itemId))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'ppe_item',
      entityId: args.itemId,
      action: 'update',
      summary: AUDIT_SUMMARY[args.action],
      before: { status: item.status },
      after: {
        status,
        action: args.action,
        personId: args.personId ?? null,
        note: args.note ?? null,
      },
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'ppe_inspection',
      targetRef: { ppeTypeId: item.typeId },
    })
    return iss?.id ?? null
  }
}

/**
 * Look up the criteria catalog for a PPE type filtered by inspection kind.
 * Ordered by section sequence then entityOrder so the on-screen render order
 * matches the builder (grouped criteria in section order, ungrouped last).
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
      .select({
        id: ppeTypeInspectionCriteria.id,
        question: ppeTypeInspectionCriteria.question,
        description: ppeTypeInspectionCriteria.description,
        severity: ppeTypeInspectionCriteria.severity,
        requiresPhoto: ppeTypeInspectionCriteria.requiresPhoto,
        entityOrder: ppeTypeInspectionCriteria.entityOrder,
      })
      .from(ppeTypeInspectionCriteria)
      .leftJoin(
        ppeTypeCriteriaGroups,
        eq(ppeTypeCriteriaGroups.id, ppeTypeInspectionCriteria.groupId),
      )
      .where(
        and(
          eq(ppeTypeInspectionCriteria.ppeTypeId, typeId),
          eq(ppeTypeInspectionCriteria.inspectionKind, kind),
        ),
      )
      .orderBy(
        asc(sql`coalesce(${ppeTypeCriteriaGroups.sequence}, 2147483647)`),
        asc(ppeTypeInspectionCriteria.entityOrder),
      )
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
  // Date-only columns ('YYYY-MM-DD') must parse as LOCAL midnight — bare
  // `new Date(iso)` parses UTC, which lands on the previous local day in
  // negative-offset timezones and shifts every due/expiry badge by a day.
  const target = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

/**
 * Tag for the per-item annual-record year column — the year of the inspectedOn
 * date. Read straight off the 'YYYY-MM-DD' string: parsing through Date would
 * mis-key Jan 1 certificates as the previous year in UTC-negative timezones.
 */
export function deriveAnnualYear(inspectedOn: string): string {
  return inspectedOn.slice(0, 4)
}
