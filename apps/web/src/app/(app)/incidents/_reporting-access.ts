import { can, type RequestContext } from '@beaconhs/tenant'
import { canUpdateRecord, ownsRecord } from '@/lib/own-record-policy'

type IncidentAccessRow = { reportedByTenantUserId: string | null; isDraft: boolean }

/**
 * Edit one incident (people, injuries, status, photos, …). A draft follows the
 * record edit rights: `incidents.update` edits any visible incident and
 * `incidents.update.own` the caller's own. Submitting hands the report over —
 * from then on only `incidents.update` (health & safety) keeps editing it.
 */
export function canUpdateIncident(ctx: RequestContext, incident: IncidentAccessRow): boolean {
  return incident.isDraft
    ? canUpdateRecord(ctx, 'incidents', [incident.reportedByTenantUserId])
    : can(ctx, 'incidents.update')
}

/**
 * Edit the reporting sections of one incident: everyone who can update it,
 * plus a reporting employee (`incidents.create`) finishing their own draft.
 */
export function canEditIncidentReporting(
  ctx: RequestContext,
  incident: IncidentAccessRow,
): boolean {
  return (
    canUpdateIncident(ctx, incident) ||
    (incident.isDraft &&
      can(ctx, 'incidents.create') &&
      ownsRecord(ctx, [incident.reportedByTenantUserId]))
  )
}
