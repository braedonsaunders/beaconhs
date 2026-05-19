// Plugin cron resolver.
//
// runPluginCron(cadence) loads every enabled tenant_plugin whose plugin
// manifest declares a cron entry at this cadence and writes a plugin_runs row
// for each. Until the plugin SDK runtime exists, every row is recorded with
// status='skipped:no_runtime' — the rows are real, so we can audit what would
// have fired and the worker is ready to flip on once handlers exist.
//
// To be wired up from apps/worker/src/workers/scheduled.ts case
// 'plugin_cron' (touching that file is out of scope for this agent — see
// summary).

import { and, eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { pluginRuns, plugins, tenantPlugins } from '@beaconhs/db/schema'

export type Cadence = 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly'

// Plugin manifest fragment we care about. The manifest is a free-form jsonb;
// we look for an optional `crons` array of `{ cadence, handler }` objects.
type PluginManifestCron = {
  cadence: Cadence | string
  handler?: string
  key?: string
}

type PluginManifestSubset = {
  crons?: PluginManifestCron[]
}

export type PluginCronRunResult = {
  cadence: Cadence
  candidates: number
  recorded: number
  errors: number
}

export async function runPluginCron(cadence: Cadence): Promise<PluginCronRunResult> {
  const result: PluginCronRunResult = { cadence, candidates: 0, recorded: 0, errors: 0 }

  const rows = await withSuperAdmin(db, async (tx) => {
    return tx
      .select({
        tenantPluginId: tenantPlugins.id,
        tenantId: tenantPlugins.tenantId,
        pluginKey: plugins.key,
        pluginName: plugins.name,
        manifest: plugins.manifest,
      })
      .from(tenantPlugins)
      .innerJoin(plugins, eq(plugins.id, tenantPlugins.pluginId))
      .where(eq(tenantPlugins.enabled, true))
  })

  for (const row of rows) {
    const manifest = row.manifest as PluginManifestSubset | null
    const crons = manifest?.crons ?? []
    const matchingCrons = crons.filter((c) => c?.cadence === cadence)
    if (matchingCrons.length === 0) continue

    result.candidates += matchingCrons.length

    for (const cron of matchingCrons) {
      try {
        const startedAt = new Date()
        await withSuperAdmin(db, (tx) =>
          tx.insert(pluginRuns).values({
            tenantId: row.tenantId,
            tenantPluginId: row.tenantPluginId,
            cadence,
            startedAt,
            completedAt: startedAt,
            status: 'skipped:no_runtime',
            durationMs: '0',
            summary: `Plugin "${row.pluginName}" cron handler "${cron.handler ?? cron.key ?? '?'}" skipped — plugin SDK runtime not implemented`,
            details: {
              pluginKey: row.pluginKey,
              handler: cron.handler ?? null,
              cronKey: cron.key ?? null,
            },
          }),
        )
        result.recorded += 1
        console.log(
          `[plugin_cron] ${cadence} skipped:no_runtime tenant=${row.tenantId} plugin=${row.pluginKey} handler=${cron.handler ?? '?'}`,
        )
      } catch (err) {
        result.errors += 1
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(
          `[plugin_cron] failed to record run for tenant=${row.tenantId} plugin=${row.pluginKey}: ${msg}`,
        )
      }
    }
  }

  // Always log a structured one-liner so the scheduler tail is greppable even
  // when nothing fires.
  console.log(
    `[plugin_cron] cadence=${cadence} candidates=${result.candidates} recorded=${result.recorded} errors=${result.errors}`,
  )
  return result
}

// Map a scheduled-tick cadence to the manifest cadence string.
// (Kept here so scheduled.ts only ever passes a typed Cadence.)
export function cadenceFromTickKind(kind: string): Cadence | null {
  switch (kind) {
    case 'plugin_cron_minute':
      return 'minute'
    case 'plugin_cron_hourly':
      return 'hourly'
    case 'plugin_cron_daily':
      return 'daily'
    case 'plugin_cron_weekly':
      return 'weekly'
    case 'plugin_cron_monthly':
      return 'monthly'
    default:
      return null
  }
}
