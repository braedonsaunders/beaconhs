// The `locations` record saver: inline edits on a location's Overview tab,
// queued on the device and applied by /api/records/sync (see
// lib/record-sync). Same rules the inline editor has always had — the
// `admin.org.manage` permission, a required name, numeric coordinates and
// geofence, the address sub-fields folded into the `address` JSON, one audit
// entry per change — plus a row lock and a compare-and-set against the value
// the device last saw. Archived locations are read-only until restored.
//
// Ops: name, code, lat, lng, geofenceMeters, the address sub-fields
// (addressLine1 … addressCountry), and `custom:<key>` custom fields.

import { and, eq } from 'drizzle-orm'
import { isUniqueViolation } from '@beaconhs/db'
import { orgUnits } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { customFieldRecordOp, isCustomFieldOp } from '@/lib/custom-fields/record-op'
import { optionalNumberInput } from '@/lib/mutation-input'
import {
  columnOps,
  optionalInteger,
  optionalText,
  requiredText,
  type Codec,
} from '@/lib/record-sync/codecs'
import {
  RecordEditRejection,
  auditFieldChanges,
  defineRecordSaver,
  recordLocked,
  recordNotFound,
  recordOp,
} from '@/lib/record-sync/edits'

type OrgUnitRow = typeof orgUnits.$inferSelect
type Address = NonNullable<OrgUnitRow['address']>

/** Address sub-fields (op key → key inside the `address` JSON). */
const LOCATION_ADDRESS_FIELDS = {
  addressLine1: 'line1',
  addressLine2: 'line2',
  addressCity: 'city',
  addressRegion: 'region',
  addressPostal: 'postal',
  addressCountry: 'country',
} as const satisfies Record<string, keyof Address>
type AddressOp = keyof typeof LOCATION_ADDRESS_FIELDS

function isAddressOp(op: string): op is AddressOp {
  return Object.prototype.hasOwnProperty.call(LOCATION_ADDRESS_FIELDS, op)
}

/** A coordinate in degrees: blank clears it. */
function coordinate(label: string, limit: number): Codec<number | null> {
  return {
    parse: (wire) => optionalNumberInput(wire, label, { min: -limit, max: limit }),
    format: (value) => (value === null ? '' : String(value)),
  }
}

const LOCATION_CODECS: { [K in keyof OrgUnitRow]?: Codec<OrgUnitRow[K]> } = {
  name: requiredText({ label: 'Name' }),
  code: optionalText({ label: 'Code' }),
  lat: coordinate('Latitude', 90),
  lng: coordinate('Longitude', 180),
  geofenceMeters: optionalInteger({ label: 'Geofence (m)', min: 0, max: 2_147_483_647 }),
}

/** The address JSON with one sub-field set (blank removes it; empty → null). */
function withAddressField(
  address: Address | null,
  key: keyof Address,
  value: string | null,
): Address | null {
  const next: Address = { ...(address ?? {}) }
  if (value === null) delete next[key]
  else next[key] = value
  return Object.keys(next).length > 0 ? next : null
}

export const locationRecordSaver = defineRecordSaver<OrgUnitRow>('locations', {
  authorize: (ctx) => can(ctx, 'admin.org.manage'),
  async load(tx, ctx, locationId) {
    const [row] = await tx
      .select()
      .from(orgUnits)
      .where(and(eq(orgUnits.id, locationId), eq(orgUnits.tenantId, ctx.tenantId)))
      .limit(1)
      .for('update')
    if (!row) throw recordNotFound()
    if (row.deletedAt) throw recordLocked('This location is archived. Restore it to edit.')
    return row
  },
  async resolve(tx, ctx, row, op) {
    const update = async (patch: Partial<OrgUnitRow>) => {
      try {
        await tx
          .update(orgUnits)
          .set(patch)
          .where(and(eq(orgUnits.id, row.id), eq(orgUnits.tenantId, ctx.tenantId)))
      } catch (error) {
        if (isUniqueViolation(error, 'org_units_tenant_code_ux')) {
          throw new RecordEditRejection('Another location already uses this code.')
        }
        throw error
      }
    }
    if (isCustomFieldOp(op)) {
      return customFieldRecordOp(tx, ctx, { kind: 'location', recordId: row.id, record: row, op })
    }
    if (isAddressOp(op)) {
      const key = LOCATION_ADDRESS_FIELDS[op]
      const codec = optionalText({ label: 'Address' })
      return recordOp<string | null>({
        current: row.address?.[key] ?? null,
        parse: codec.parse,
        format: codec.format,
        write: async (value) => {
          const address = withAddressField(row.address, key, value)
          await update({ address })
          row.address = address
        },
      })
    }
    return columnOps(row, LOCATION_CODECS, update)(op)
  },
  afterWrites: (tx, ctx, row, changes) =>
    auditFieldChanges(
      tx,
      ctx,
      { entityType: 'org_unit', entityId: row.id },
      changes.filter((change) => !isCustomFieldOp(change.op)),
    ),
  revalidate: (locationId) => [`/locations/${locationId}`, '/locations'],
})
