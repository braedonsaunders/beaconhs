import { Badge } from '@beaconhs/ui'

export function ToolboxStatusBadge({ status }: { status: 'draft' | 'submitted' | 'closed' }) {
  if (status === 'closed') return <Badge variant="success">Closed</Badge>
  if (status === 'submitted') return <Badge variant="default">Submitted</Badge>
  return <Badge variant="secondary">Draft</Badge>
}
