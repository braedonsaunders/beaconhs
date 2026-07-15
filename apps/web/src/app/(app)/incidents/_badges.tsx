import { GeneratedValue } from '@/i18n/generated'
import { Badge } from '@beaconhs/ui'

export function SeverityBadge({ severity }: { severity: string }) {
  const v =
    severity === 'fatality' || severity === 'lost_time'
      ? 'destructive'
      : severity === 'medical_aid'
        ? 'warning'
        : severity === 'first_aid_only'
          ? 'secondary'
          : 'outline'
  return (
    <Badge variant={v as any}>
      <GeneratedValue value={severity.replace(/_/g, ' ')} />
    </Badge>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const v =
    status === 'closed'
      ? 'success'
      : status === 'under_investigation' || status === 'pending_review'
        ? 'warning'
        : status === 'reopened'
          ? 'destructive'
          : 'secondary'
  return (
    <Badge variant={v as any}>
      <GeneratedValue value={status.replace(/_/g, ' ')} />
    </Badge>
  )
}
