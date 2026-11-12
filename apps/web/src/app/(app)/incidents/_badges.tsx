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

/** A started report that has not been submitted shows as a draft, whatever its status. */
export function StatusBadge({ status, isDraft = false }: { status: string; isDraft?: boolean }) {
  if (isDraft) {
    return (
      <Badge variant="outline">
        <GeneratedValue value="draft" />
      </Badge>
    )
  }
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
