// The `incidents` record saver: inline field edits on an incident, queued on
// the device by the record page and applied by /api/records/sync (see
// lib/record-sync). Same rules the inline editor has always had — the
// `incidents.update` permission, record visibility (read.all / site / own),
// locked incidents are read-only, one audit entry per changed field — plus a
// compare-and-set against the value the device last saw.

import { and, eq, isNull } from 'drizzle-orm'
import { incidents } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import {
  choice,
  columnOps,
  flag,
  optionalDate,
  optionalDateTime,
  optionalDecimal,
  optionalInteger,
  optionalRef,
  optionalRichText,
  optionalText,
  requiredDateTime,
  requiredText,
  type Codec,
} from '@/lib/record-sync/codecs'
import {
  auditFieldChanges,
  defineRecordSaver,
  recordLocked,
  recordNotFound,
} from '@/lib/record-sync/edits'
import { INCIDENT_SEVERITIES, INCIDENT_TYPES } from './_options'

type IncidentRow = typeof incidents.$inferSelect

function incidentCodecs(timeZone: string): { [K in keyof IncidentRow]?: Codec<IncidentRow[K]> } {
  const text = (label: string) => optionalText({ label, maxLength: 20_000, keepWhitespace: true })
  const rich = (label: string) => optionalRichText({ label, maxLength: 200_000 })
  const at = (label: string) => optionalDateTime({ label, timeZone })
  const rating = (label: string) => optionalInteger({ label, min: 1, max: 5 })
  const days = (label: string) => optionalInteger({ label, min: 0, max: 100_000 })
  return {
    type: choice(INCIDENT_TYPES, { label: 'Type' }),
    severity: choice(INCIDENT_SEVERITIES, { label: 'Severity' }),
    title: requiredText({ label: 'Title', maxLength: 500, keepWhitespace: true }),
    occurredAt: requiredDateTime({ label: 'Occurred at', timeZone }),
    siteOrgUnitId: optionalRef({ label: 'Site' }),
    departmentId: optionalRef({ label: 'Department' }),
    supervisorPersonId: optionalRef({ label: 'Supervisor' }),
    classificationId: optionalRef({ label: 'Classification' }),
    location: text('Location'),
    weather: text('Weather'),
    foremanText: text('Foreman'),
    ppeWorn: text('PPE worn'),
    eventsLeadingUp: rich('Events leading up'),
    description: rich('Description'),
    immediateActionTaken: rich('Immediate action taken'),
    witnesses: rich('Witnesses'),
    externalPeopleInvolved: rich('External people involved'),
    rootCause: rich('Root cause'),
    firstAidProvider: text('First aid provider'),
    firstAidNotes: text('First aid notes'),
    hospitalName: text('Hospital'),
    treatedInCity: text('Treated in city'),
    transportation: text('Transportation'),
    attendingPhysician: text('Attending physician'),
    molReportNumber: text('Report number'),
    policeReportNumber: text('Police report number'),
    insuranceClaimNumber: text('Insurance claim number'),
    criticalInjury: flag(),
    ministryOfLabourNotified: flag(),
    emsCalled: flag(),
    firstAidGiven: flag(),
    medicalAttentionReceived: flag(),
    lostTime: flag(),
    modifiedDuty: flag(),
    externallyReportable: flag(),
    policeNotified: flag(),
    emsArrivedAt: at('EMS arrived'),
    hospitalArrivedAt: at('Hospital arrival'),
    dischargedAt: at('Discharged'),
    molNotifiedAt: at('Notified at'),
    lostTimeFirstDay: optionalDate({ label: 'First day' }),
    lostTimeLastDay: optionalDate({ label: 'Last day' }),
    modifiedDutyFirstDay: optionalDate({ label: 'First day' }),
    modifiedDutyLastDay: optionalDate({ label: 'Last day' }),
    lostTimeDays: days('Lost time days'),
    modifiedDutyDays: days('Modified duty days'),
    actualSeverity: rating('Actual severity'),
    potentialSeverity: rating('Potential severity'),
    severityRating: rating('Severity rating'),
    damageEstimate: optionalDecimal({ label: 'Damage estimate', min: 0, maxScale: 2 }),
  }
}

export const incidentRecordSaver = defineRecordSaver<IncidentRow>('incidents', {
  authorize: (ctx) => can(ctx, 'incidents.update'),
  async load(tx, ctx, incidentId) {
    const [row] = await tx
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.id, incidentId),
          eq(incidents.tenantId, ctx.tenantId),
          isNull(incidents.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!row) throw recordNotFound()
    // A self/site-tier user must not edit an incident they cannot see.
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'incidents',
      ownerIds: [row.reportedByTenantUserId],
      siteId: row.siteOrgUnitId,
    })
    if (!visible) throw recordNotFound()
    if (row.locked) throw recordLocked('Incident is locked')
    return row
  },
  resolve: (tx, ctx, row, op) =>
    columnOps(row, incidentCodecs(ctx.timezone), (patch) =>
      tx
        .update(incidents)
        .set(patch)
        .where(and(eq(incidents.id, row.id), eq(incidents.tenantId, ctx.tenantId))),
    )(op),
  afterWrites: (tx, ctx, row, changes) =>
    auditFieldChanges(tx, ctx, { entityType: 'incident', entityId: row.id }, changes),
  revalidate: (incidentId) => [`/incidents/${incidentId}`, '/incidents'],
})
