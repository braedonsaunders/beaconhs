import type { SyncEntityStat } from '@beaconhs/db/schema'
import { GeneratedValue } from '@/i18n/generated'

export function EquipmentTelemetryRunStats({ stats }: { stats: SyncEntityStat }) {
  const counters = [
    ['Trackers checked', stats.pulled],
    ['New trackers', stats.created],
    ['Changed trackers', stats.updated],
    ['Unchanged trackers', stats.unchanged],
    ...(stats.observationsCreated === undefined
      ? []
      : [['New GPS observations', stats.observationsCreated]]),
  ] as const
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
      {counters.map(([label, value]) => (
        <span key={label}>
          <GeneratedValue value={label} />:{' '}
          <strong className="font-medium tabular-nums">{value}</strong>
        </span>
      ))}
    </span>
  )
}
