import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// Shared display helpers for the reports module. (Previously exported from
// the hub page.tsx and imported page→page — kept here so route modules only
// export route things.)

import { Badge } from '@beaconhs/ui'

export function formatCadence(
  cadence: 'daily' | 'weekly' | 'monthly',
  dow: number | null,
  dom: number | null,
  hour: number,
  minute: number,
  tz: string,
): string {
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  if (cadence === 'daily') return `Daily @ ${time} ${tz}`
  if (cadence === 'weekly') return `Weekly · ${days[dow ?? 1]} @ ${time} ${tz}`
  return `Monthly · day ${dom ?? 1} @ ${time} ${tz}`
}

export function StatusBadge({ status }: { status: 'queued' | 'running' | 'succeeded' | 'failed' }) {
  const variant =
    status === 'succeeded'
      ? 'success'
      : status === 'failed'
        ? 'destructive'
        : status === 'running'
          ? 'warning'
          : 'secondary'
  return (
    <Badge variant={variant as never}>
      <GeneratedValue value={status} />
    </Badge>
  )
}

export function KindBadge({ kind }: { kind: 'built_in' | 'custom' }) {
  return kind === 'custom' ? (
    <Badge variant="secondary">
      <GeneratedText id="m_0abce084240d5f" />
    </Badge>
  ) : (
    <Badge variant="outline">
      <GeneratedText id="m_0f80f48f1b18f1" />
    </Badge>
  )
}

export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  return (
    <Badge variant="outline">
      <GeneratedValue value={category.replace(/_/g, ' ')} />
    </Badge>
  )
}
