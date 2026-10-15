// The `corrective-actions` record saver: inline field edits on a corrective
// action, queued on the device by the record page and applied by
// /api/records/sync (see lib/record-sync). Same rules the inline editor has
// always had — the `ca.update` permission, record visibility (read.all /
// site / own), locked (closed) actions are read-only, one audit entry per
// changed field, and compliance evidence obligations follow due-date and
// owner changes — plus a compare-and-set against the value the device last
// saw.

import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { activeTenantUsersWhere, type Database } from '@beaconhs/db'
import {
  correctiveActionSeverity,
  correctiveActionSource,
  correctiveActions,
  orgUnits,
  tenantUsers,
} from '@beaconhs/db/schema'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { recordDomainEvent } from '@beaconhs/events'
import { can } from '@beaconhs/tenant'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import {
  choice,
  columnOps,
  flag,
  optionalDate,
  optionalDecimal,
  optionalRef,
  optionalRichText,
  requiredText,
  type Codec,
} from '@/lib/record-sync/codecs'
import {
  auditFieldChanges,
  defineRecordSaver,
  RecordEditRejection,
  recordLocked,
  recordNotFound,
} from '@/lib/record-sync/edits'

type CorrectiveActionRow = typeof correctiveActions.$inferSelect

const rich = (label: string) => optionalRichText({ label, maxLength: 200_000 })

const CORRECTIVE_ACTION_CODECS: {
  [K in keyof CorrectiveActionRow]?: Codec<CorrectiveActionRow[K]>
} = {
  title: requiredText({ label: 'Title', maxLength: 500, keepWhitespace: true }),
  severity: choice(correctiveActionSeverity.enumValues, { label: 'Severity' }),
  source: choice(correctiveActionSource.enumValues, { label: 'Source', nullable: true }),
  siteOrgUnitId: optionalRef({ label: 'Site' }),
  ownerTenantUserId: optionalRef({ label: 'Owner' }),
  assignedOn: optionalDate({ label: 'Assigned on' }),
  dueOn: optionalDate({ label: 'Due on' }),
  // numeric(12, 2), the same non-negative cents rule the Close drawer applies.
  costImpact: optionalDecimal({ label: 'Cost impact', min: 0, max: 9_999_999_999.99, maxScale: 2 }),
  verificationRequired: flag(),
  description: rich('Description'),
  rootCause: rich('Root cause'),
  actionTaken: rich('Action taken'),
}

/** The Site and Owner pickers only offer live sites and active members; hold edits to the same. */
async function assertReferences(
  tx: Database,
  ctx: { tenantId: string },
  patch: Partial<CorrectiveActionRow>,
): Promise<void> {
  if (patch.siteOrgUnitId) {
    const [site] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.id, patch.siteOrgUnitId),
          eq(orgUnits.tenantId, ctx.tenantId),
          isNull(orgUnits.deletedAt),
        ),
      )
      .limit(1)
    if (!site) throw new RecordEditRejection('Site is invalid.')
  }
  if (patch.ownerTenantUserId) {
    // Held until commit so the owner cannot be deactivated mid-assignment.
    const [owner] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(
        and(
          eq(tenantUsers.id, patch.ownerTenantUserId),
          eq(tenantUsers.tenantId, ctx.tenantId),
          activeTenantUsersWhere(),
        ),
      )
      .limit(1)
      .for('update')
    if (!owner) throw new RecordEditRejection('Choose an active owner.')
  }
}

export const correctiveActionRecordSaver = defineRecordSaver<CorrectiveActionRow>(
  'corrective-actions',
  {
    authorize: (ctx) => can(ctx, 'ca.update'),
    async load(tx, ctx, caId) {
      const [row] = await tx
        .select()
        .from(correctiveActions)
        .where(
          and(
            eq(correctiveActions.id, caId),
            eq(correctiveActions.tenantId, ctx.tenantId),
            isNull(correctiveActions.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!row) throw recordNotFound()
      // A self/site-tier user must not edit an action they cannot see.
      const visible = await canSeeRecord(ctx, tx, {
        prefix: 'ca',
        ownerIds: [row.ownerTenantUserId],
        siteId: row.siteOrgUnitId,
      })
      if (!visible) throw recordNotFound()
      if (row.locked) throw recordLocked('This action is locked')
      return row
    },
    resolve: (tx, ctx, row, op) =>
      columnOps(row, CORRECTIVE_ACTION_CODECS, async (patch) => {
        await assertReferences(tx, ctx, patch)
        await tx
          .update(correctiveActions)
          .set(patch)
          .where(
            and(eq(correctiveActions.id, row.id), eq(correctiveActions.tenantId, ctx.tenantId)),
          )
      })(op),
    async afterWrites(tx, ctx, row, changes) {
      const entity = { entityType: 'corrective_action', entityId: row.id }
      await auditFieldChanges(tx, ctx, entity, changes)
      const reassigned = changes.some((change) => change.op === 'ownerTenantUserId')
      // A reassigned action notifies its new owner, as a bulk reassignment does.
      if (reassigned && row.ownerTenantUserId) {
        await recordDomainEvent(tx, {
          tenantId: ctx.tenantId,
          eventType: 'corrective_action.assigned',
          subjectId: row.id,
          dedupKey: `corrective_action.assigned:${row.id}:${randomUUID()}`,
          payload: { notification: { kind: 'corrective_action_assigned', caId: row.id } },
        })
      }
      if (changes.some((change) => change.op === 'dueOn' || change.op === 'ownerTenantUserId')) {
        await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
          sourceModule: 'corrective_action',
          targetRef: {},
        })
      }
    },
    revalidate: (caId) => [`/corrective-actions/${caId}`, '/corrective-actions'],
  },
)
