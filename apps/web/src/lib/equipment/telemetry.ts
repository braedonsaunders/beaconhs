import { sql } from 'drizzle-orm'
import { equipmentTelemetryAssets as assets, syncConnections } from '@beaconhs/db/schema'

export const TELEMETRY_HEALTH_LABELS = {
  fresh: 'Reporting',
  stale: 'Stale location',
  invalid: 'No valid GPS fix',
  never: 'Never reported',
  outage: 'Integration error',
  delayed: 'Sync delayed',
  paused: 'Automatic sync off',
  inactive: 'Inactive in source',
} as const

// Query and filter use the same expression so health filters cannot disagree
// with the badges. Location age, rather than ingestion age, controls freshness.
export const telemetryHealthSql = sql<keyof typeof TELEMETRY_HEALTH_LABELS>`CASE
  WHEN NOT ${assets.sourcePresent} OR ${assets.deactivated} THEN 'inactive'
  WHEN ${syncConnections.status} = 'error' OR ${syncConnections.lastStatus} IN ('error','partial') THEN 'outage'
  WHEN NOT ${syncConnections.enabled} THEN 'paused'
  WHEN ${syncConnections.lastRunAt} < now() - make_interval(mins => CASE ${syncConnections.schedule}
    WHEN '5min' THEN 15 WHEN '15min' THEN 45 WHEN 'hourly' THEN 180
    WHEN '6h' THEN 1080 WHEN 'daily' THEN 4320 WHEN 'weekly' THEN 30240 ELSE 2147483647 END) THEN 'delayed'
  WHEN ${assets.lastReportedAt} IS NULL THEN 'never'
  WHEN NOT ${assets.gpsValid} OR ${assets.locationObservedAt} IS NULL THEN 'invalid'
  WHEN ${assets.locationObservedAt} < now() - make_interval(mins => CASE
    WHEN (${syncConnections.config}->>'staleAfterMinutes') ~ '^[0-9]{1,5}$'
    THEN greatest(5, least(10080, (${syncConnections.config}->>'staleAfterMinutes')::int))
    ELSE 1440 END) THEN 'stale'
  ELSE 'fresh' END`
