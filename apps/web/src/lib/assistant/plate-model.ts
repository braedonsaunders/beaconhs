// Pure shaping for the assistant plate. No database, so tests and the prompt
// can import it without the server-only dashboard loader.

import type { ComplianceTargetRef } from '@beaconhs/db/schema'
import { complianceActionLabel, resolveComplianceLink } from '@/app/(app)/compliance/_resolve-link'
import { kindLabel } from '@/app/(app)/compliance/obligations/_meta'

export type TrainingAttentionState = 'expired' | 'expiring'

export function addUtcDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function classifyTrainingExpiry(
  expiresOn: string | null,
  todayIso: string,
  horizonIso: string,
): TrainingAttentionState | null {
  if (!expiresOn) return null
  if (expiresOn < todayIso) return 'expired'
  if (expiresOn <= horizonIso) return 'expiring'
  return null
}

export type CompliancePlateSource = {
  kind: string
  obligationId: string
  title: string
  status: string
  dueOn: string | null
  targetRef: ComplianceTargetRef | null
  subjectRef: Record<string, string> | null
}

export type PlateComplianceItem = {
  obligationId: string
  kind: string
  kindLabel: string
  title: string
  status: string
  dueOn: string | null
  href: string | null
  action: string
}

/** Outstanding rows only. Caller passes them already ranked. */
export function toPlateCompliance(
  rows: CompliancePlateSource[],
  personId: string,
  limit = 40,
): {
  outstanding: number
  overdue: number
  returned: number
  truncated: boolean
  items: PlateComplianceItem[]
} {
  const outstanding = rows.filter((row) => row.status !== 'completed')
  const items = outstanding.slice(0, limit).map((row) => {
    const link = resolveComplianceLink(row.kind, row.targetRef, {
      personId,
      obligationId: row.obligationId,
      responseId:
        row.status === 'completed' && row.kind === 'form'
          ? (row.subjectRef?.responseId ?? null)
          : null,
    })
    return {
      obligationId: row.obligationId,
      kind: row.kind,
      kindLabel: kindLabel(row.kind),
      title: row.title,
      status: row.status,
      dueOn: row.dueOn,
      href: link?.href ?? null,
      action: complianceActionLabel(row.kind),
    }
  })
  return {
    outstanding: outstanding.length,
    overdue: outstanding.filter((row) => row.status === 'overdue' || row.status === 'expiring')
      .length,
    returned: items.length,
    truncated: outstanding.length > items.length,
    items,
  }
}
