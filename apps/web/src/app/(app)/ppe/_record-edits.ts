// The `ppe-items` record saver: inline edits on a PPE item's Overview, queued
// on the device and applied by /api/records/sync (see lib/record-sync). Same
// rules the inline editor has always had — the `ppe.manage` permission, only
// user-owned identity fields (status, holder, and schedule dates stay with
// the issuance and inspection flows), trimmed text, a required type that
// belongs to the tenant, serial numbers unique per tenant, compliance evidence
// refreshed when the expiry or type moves, one audit entry per change — plus
// a row lock and a compare-and-set against the value the device last saw.
// Deleted items cannot be edited (there is no restore).
//
// Ops: typeId, serialNumber, size, purchaseDate, expiresOn, notes, and
// `custom:<key>` custom fields.

import { and, eq } from 'drizzle-orm'
import { isUniqueViolation } from '@beaconhs/db'
import { ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { materializePpeTypeEvidence } from '@/lib/compliance-type-evidence'
import { customFieldRecordOp, isCustomFieldOp } from '@/lib/custom-fields/record-op'
import {
  columnOps,
  optionalDate,
  optionalText,
  requiredRef,
  type Codec,
} from '@/lib/record-sync/codecs'
import {
  RecordEditRejection,
  RecordSyncError,
  auditFieldChanges,
  defineRecordSaver,
  recordNotFound,
} from '@/lib/record-sync/edits'
import { PPE_SERIAL_UNIQUE_CONSTRAINT } from './_lib'

type PpeItemRow = typeof ppeItems.$inferSelect
type LoadedPpeItem = { row: PpeItemRow; priorTypeId: string }

// Stored trimmed: a stray space would otherwise make two serials that read
// identically collide-free against the unique index.
const PPE_ITEM_CODECS: { [K in keyof PpeItemRow]?: Codec<PpeItemRow[K]> } = {
  typeId: requiredRef({ label: 'Type' }),
  serialNumber: optionalText({ label: 'Serial #' }),
  size: optionalText({ label: 'Size' }),
  notes: optionalText({ label: 'Notes' }),
  purchaseDate: optionalDate({ label: 'Purchased' }),
  expiresOn: optionalDate({ label: 'Expires' }),
}

export const ppeItemRecordSaver = defineRecordSaver<LoadedPpeItem>('ppe-items', {
  authorize: (ctx) => can(ctx, 'ppe.manage'),
  async load(tx, ctx, itemId) {
    const [row] = await tx
      .select()
      .from(ppeItems)
      .where(and(eq(ppeItems.id, itemId), eq(ppeItems.tenantId, ctx.tenantId)))
      .limit(1)
      .for('update')
    if (!row) throw recordNotFound()
    if (row.deletedAt) throw new RecordSyncError('closed', 'This PPE item was deleted.')
    return { row, priorTypeId: row.typeId }
  },
  resolve(tx, ctx, { row }, op) {
    if (isCustomFieldOp(op)) {
      return customFieldRecordOp(tx, ctx, { kind: 'ppe', recordId: row.id, record: row, op })
    }
    return columnOps(row, PPE_ITEM_CODECS, async (patch) => {
      if (patch.typeId) {
        const [type] = await tx
          .select({ id: ppeTypes.id })
          .from(ppeTypes)
          .where(and(eq(ppeTypes.id, patch.typeId), eq(ppeTypes.tenantId, ctx.tenantId)))
          .limit(1)
        if (!type) throw new RecordEditRejection('Selected PPE type is unavailable.')
      }
      try {
        await tx
          .update(ppeItems)
          .set(patch)
          .where(and(eq(ppeItems.id, row.id), eq(ppeItems.tenantId, ctx.tenantId)))
      } catch (error) {
        // Serial numbers are unique per tenant — say so plainly.
        if (isUniqueViolation(error, PPE_SERIAL_UNIQUE_CONSTRAINT)) {
          throw new RecordEditRejection(
            `Serial number "${patch.serialNumber ?? ''}" is already used by another PPE item.`,
          )
        }
        throw error
      }
    })(op)
  },
  async afterWrites(tx, ctx, { row, priorTypeId }, changes) {
    const native = changes.filter((change) => !isCustomFieldOp(change.op))
    await auditFieldChanges(tx, ctx, { entityType: 'ppe_item', entityId: row.id }, native)
    if (native.some((change) => change.op === 'expiresOn' || change.op === 'typeId')) {
      await materializePpeTypeEvidence(tx, ctx.tenantId, [priorTypeId, row.typeId])
    }
  },
  revalidate: (itemId) => [`/ppe/${itemId}`, '/ppe'],
})
