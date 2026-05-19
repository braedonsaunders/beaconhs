import { Badge } from '@beaconhs/ui'
import { formatStatus, type LiftPlanStatus } from './_types'

const STATUS_VARIANT: Record<
  LiftPlanStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
> = {
  draft: 'secondary',
  approved: 'default',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'destructive',
}

export function StatusBadge({ status }: { status: LiftPlanStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className="capitalize">
      {formatStatus(status)}
    </Badge>
  )
}

/**
 * Show capacity utilisation as a coloured chip:
 *   <= 75% green, 76–89% amber, 90%+ red. Reads ergonomically next to a
 *   crane row.
 */
export function CapacityBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <Badge variant="outline">—</Badge>
  const n = Math.round(pct * 10) / 10
  if (n >= 90) return <Badge variant="destructive">{n}%</Badge>
  if (n >= 76) return <Badge variant="warning">{n}%</Badge>
  return <Badge variant="success">{n}%</Badge>
}
