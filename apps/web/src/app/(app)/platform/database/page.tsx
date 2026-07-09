import { AlertTriangle, CheckCircle2, Database } from 'lucide-react'
import { Button, Card, CardContent, DetailHeader, Input, cn } from '@beaconhs/ui'
import { MAINTENANCE_TABLES, resolveRetentionDays } from '@beaconhs/db'
import { getRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { PageContainer } from '@/components/page-layout'
import {
  getDbMaintenanceSettings,
  getMaintenanceTableSizes,
  type MaintenanceTableSize,
} from '@/lib/db-maintenance-config'
import { savePlatformDatabase } from './_actions'
import { RunMaintenanceButton } from './_run-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Database maintenance' }

const numberFmt = new Intl.NumberFormat('en-US')

function formatRows(rows: number): string {
  if (rows >= 1_000_000) return `${(rows / 1_000_000).toFixed(1)}M`
  if (rows >= 10_000) return `${(rows / 1_000).toFixed(0)}K`
  return numberFmt.format(rows)
}

// Authorization is enforced once by /platform/layout.tsx (super-admin only).
export default async function PlatformDatabasePage() {
  const [settings, sizes] = await Promise.all([
    getDbMaintenanceSettings(),
    getMaintenanceTableSizes(),
  ])
  const sizeByTable = new Map<string, MaintenanceTableSize>(sizes.map((s) => [s.table, s]))
  const timeZone = (await getRequestContext())?.timezone ?? 'UTC'
  const lastRun = settings.lastRun

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-4">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title="Database maintenance"
          subtitle="Retention windows for high-volume tables. Rows past the window are pruned nightly; statistics are refreshed each run."
        />

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Retention windows
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                These append-only logs and ledgers grow without bound. Set how long to keep each one
                — leave blank to keep forever. Pruning is non-destructive to live operations.
              </p>
            </div>

            <form action={savePlatformDatabase} className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                      <th className="px-3 py-2 font-medium">Table</th>
                      <th className="px-3 py-2 text-right font-medium">Size</th>
                      <th className="px-3 py-2 text-right font-medium">Rows</th>
                      <th className="px-3 py-2 font-medium">Keep (days)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {MAINTENANCE_TABLES.map((t) => {
                      const size = sizeByTable.get(t.table)
                      const retention = resolveRetentionDays(settings, t)
                      return (
                        <tr key={t.table} className="bg-white dark:bg-slate-900">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {t.label}
                            </div>
                            <div className="font-mono text-xs text-slate-400 dark:text-slate-500">
                              {t.table}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600 tabular-nums dark:text-slate-300">
                            {size?.prettySize ?? '—'}
                          </td>
                          <td
                            className="px-3 py-2 text-right text-slate-600 tabular-nums dark:text-slate-300"
                            title={size ? numberFmt.format(size.rows) : undefined}
                          >
                            {size ? formatRows(size.rows) : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              name={`retention_${t.table}`}
                              defaultValue={retention === null ? '' : String(retention)}
                              placeholder="Keep forever"
                              aria-label={`Retention days for ${t.label}`}
                              className="h-9 w-36"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                <Button type="submit">Save retention</Button>
              </div>
            </form>

            <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Run a maintenance pass immediately, outside the nightly schedule
              </p>
              <RunMaintenanceButton />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center gap-2">
              <Database size={15} className="text-slate-400 dark:text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Last run</h2>
            </div>
            {lastRun ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                      lastRun.ok
                        ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300'
                        : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
                    )}
                  >
                    {lastRun.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {lastRun.ok ? 'Completed' : 'Completed with errors'}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300">
                    {formatDateTime(new Date(lastRun.at), timeZone)}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500">
                    {lastRun.trigger === 'manual' ? 'Manual' : 'Scheduled'} ·{' '}
                    {(lastRun.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                        <th className="px-3 py-2 font-medium">Table</th>
                        <th className="px-3 py-2 text-right font-medium">Pruned</th>
                        <th className="px-3 py-2 text-right font-medium">Window</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {lastRun.perTable.map((p) => {
                        const meta = MAINTENANCE_TABLES.find((t) => t.table === p.table)
                        return (
                          <tr key={p.table} className="bg-white dark:bg-slate-900">
                            <td className="px-3 py-2 text-slate-900 dark:text-slate-100">
                              {meta?.label ?? p.table}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600 tabular-nums dark:text-slate-300">
                              {numberFmt.format(p.deleted)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600 tabular-nums dark:text-slate-300">
                              {p.retentionDays === null ? 'Forever' : `${p.retentionDays}d`}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {p.error ? (
                                <span className="text-red-600 dark:text-red-400">{p.error}</span>
                              ) : p.analyzed ? (
                                <span className="text-slate-500 dark:text-slate-400">Analyzed</span>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No maintenance run has been recorded yet. The first nightly pass runs at 03:30, or
                trigger one now above.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
