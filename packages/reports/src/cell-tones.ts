import type { ReportCellTone, ReportRunResult } from '@braedonsaunders/appkit-reports'

// Domain colouring for report cells.
//
// AppKit owns the MECHANISM (ReportColumn.tones, applied identically by the
// screen view and the PDF). BeaconHS owns the MEANING — what "expired" is, and
// how urgent it should look — so the rules live here in the adapter rather than
// being baked into the platform.
//
// Applied to a run result, so every surface that renders one (viewer, PDF,
// scheduled email attachment) colours the same way without each having to
// remember to ask.

/** Column key → value → tone. Values match case-insensitively. */
const COLUMN_TONES: Record<string, Record<string, ReportCellTone>> = {
  // Bookings are a scheduling status, not proof of a valid qualification.
  booking_coverage_status: {
    booked: 'info',
    expired: 'critical',
    missing: 'critical',
    expiring: 'warning',
    valid: 'positive',
  },
  coverage_status: {
    expired: 'critical',
    missing: 'critical',
    expiring: 'warning',
    valid: 'positive',
  },
  // Skill / certification assignment lifecycle.
  status: {
    expired: 'critical',
    revoked: 'critical',
    expiring: 'warning',
    active: 'positive',
    valid: 'positive',
    complete: 'positive',
    failed: 'critical',
    tested: 'info',
    recommended: 'warning',
    draft: 'muted',
    granted: 'positive',
  },
  // Inspection and checklist outcomes.
  result: {
    fail: 'critical',
    failed: 'critical',
    pass: 'positive',
    passed: 'positive',
    na: 'muted',
    'n/a': 'muted',
  },
  is_missing: { true: 'critical', yes: 'critical' },
}

/**
 * Attach the domain tone rules to a run result's columns.
 *
 * Mutation-free: returns a new result whose columns carry `tones`. Columns with
 * no rule are returned untouched, so a report only gains colour where the
 * meaning is unambiguous.
 */
export function withDomainCellTones(result: ReportRunResult): ReportRunResult {
  return {
    ...result,
    groups: result.groups.map((group) => ({
      ...group,
      columns: group.columns.map((column) => {
        const tones = COLUMN_TONES[column.key]
        return tones ? { ...column, tones } : column
      }),
    })),
  }
}
