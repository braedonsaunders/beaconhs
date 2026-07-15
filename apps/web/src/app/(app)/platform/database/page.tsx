import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a74b5af3582f5') }
}

function formatRows(rows: number, locale: string): string {
  if (rows >= 1_000_000) return `${(rows / 1_000_000).toFixed(1)}M`
  if (rows >= 10_000) return `${(rows / 1_000).toFixed(0)}K`
  return new Intl.NumberFormat(locale).format(rows)
}

// Authorization is enforced once by /platform/layout.tsx (super-admin only).
export default async function PlatformDatabasePage() {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const [settings, sizes] = await Promise.all([
    getDbMaintenanceSettings(),
    getMaintenanceTableSizes(),
  ])
  const sizeByTable = new Map<string, MaintenanceTableSize>(sizes.map((s) => [s.table, s]))
  const requestContext = await getRequestContext()
  const timeZone = requestContext?.timezone ?? 'UTC'
  const locale = requestContext?.locale ?? 'en'
  const numberFmt = new Intl.NumberFormat(locale)
  const lastRun = settings.lastRun

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-4">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title={tGenerated('m_1a74b5af3582f5')}
          subtitle={tGenerated('m_0ef6d3af26387e')}
        />

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedText id="m_06c8366965f3ab" />
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_17cdd1c482b20f" />
              </p>
            </div>

            <form action={savePlatformDatabase} className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                      <th className="px-3 py-2 font-medium">
                        <GeneratedText id="m_1ccaefc0402329" />
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        <GeneratedText id="m_11ad4bbeced31b" />
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        <GeneratedText id="m_03be2202673df4" />
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <GeneratedText id="m_0d46d529e0f9ec" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    <GeneratedValue
                      value={MAINTENANCE_TABLES.map((t) => {
                        const size = sizeByTable.get(t.table)
                        const retention = resolveRetentionDays(settings, t)
                        return (
                          <tr key={t.table} className="bg-white dark:bg-slate-900">
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                <GeneratedValue value={t.label} />
                              </div>
                              <div className="font-mono text-xs text-slate-400 dark:text-slate-500">
                                <GeneratedValue value={t.table} />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600 tabular-nums dark:text-slate-300">
                              <GeneratedValue value={size?.prettySize ?? '—'} />
                            </td>
                            <td
                              className="px-3 py-2 text-right text-slate-600 tabular-nums dark:text-slate-300"
                              title={tGeneratedValue(
                                size ? numberFmt.format(size.rows) : undefined,
                              )}
                            >
                              <GeneratedValue value={size ? formatRows(size.rows, locale) : '—'} />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                name={`retention_${t.table}`}
                                defaultValue={retention === null ? '' : String(retention)}
                                placeholder={tGenerated('m_1cd04156b12f00')}
                                aria-label={tGenerated('m_1cd8cd406c6d4b', { value0: t.label })}
                                className="h-9 w-36"
                              />
                            </td>
                          </tr>
                        )
                      })}
                    />
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                <Button type="submit">
                  <GeneratedText id="m_148e2cb09a6319" />
                </Button>
              </div>
            </form>

            <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                <GeneratedText id="m_0e0c28a25c81fa" />
              </p>
              <RunMaintenanceButton />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center gap-2">
              <Database size={15} className="text-slate-400 dark:text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedText id="m_1236782a321d73" />
              </h2>
            </div>
            <GeneratedValue
              value={
                lastRun ? (
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
                        <GeneratedValue
                          value={
                            lastRun.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />
                          }
                        />
                        <GeneratedValue
                          value={
                            lastRun.ok ? (
                              <GeneratedText id="m_0ba7a5e1b2fa32" />
                            ) : (
                              <GeneratedText id="m_1caf6cbe468905" />
                            )
                          }
                        />
                      </span>
                      <span className="text-slate-600 dark:text-slate-300">
                        <GeneratedValue
                          value={formatDateTime(new Date(lastRun.at), timeZone, locale)}
                        />
                      </span>
                      <span className="text-slate-400 dark:text-slate-500">
                        <GeneratedValue
                          value={
                            lastRun.trigger === 'manual' ? (
                              <GeneratedText id="m_132166f2d04b7c" />
                            ) : (
                              <GeneratedText id="m_14ad4ca1d87e79" />
                            )
                          }
                        />{' '}
                        ·<GeneratedValue value={' '} />
                        <GeneratedValue value={(lastRun.durationMs / 1000).toFixed(1)} />
                        <GeneratedText id="m_00ded356f0f424" />
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                            <th className="px-3 py-2 font-medium">
                              <GeneratedText id="m_1ccaefc0402329" />
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              <GeneratedText id="m_1b155fcab71a79" />
                            </th>
                            <th className="px-3 py-2 text-right font-medium">
                              <GeneratedText id="m_0253b774dff267" />
                            </th>
                            <th className="px-3 py-2 font-medium">
                              <GeneratedText id="m_0b9da892d6faf0" />
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          <GeneratedValue
                            value={lastRun.perTable.map((p) => {
                              const meta = MAINTENANCE_TABLES.find((t) => t.table === p.table)
                              return (
                                <tr key={p.table} className="bg-white dark:bg-slate-900">
                                  <td className="px-3 py-2 text-slate-900 dark:text-slate-100">
                                    <GeneratedValue value={meta?.label ?? p.table} />
                                  </td>
                                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums dark:text-slate-300">
                                    <GeneratedValue value={numberFmt.format(p.deleted)} />
                                  </td>
                                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums dark:text-slate-300">
                                    <GeneratedValue
                                      value={
                                        p.retentionDays === null ? (
                                          <GeneratedText id="m_18dcf10861ff53" />
                                        ) : (
                                          <GeneratedText
                                            id="m_144bd4e23f1233"
                                            values={{ value0: p.retentionDays }}
                                          />
                                        )
                                      }
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-xs">
                                    <GeneratedValue
                                      value={
                                        p.error ? (
                                          <span className="text-red-600 dark:text-red-400">
                                            <GeneratedValue value={p.error} />
                                          </span>
                                        ) : p.analyzed ? (
                                          <span className="text-slate-500 dark:text-slate-400">
                                            <GeneratedText id="m_1df7325e17c1a7" />
                                          </span>
                                        ) : (
                                          <span className="text-slate-400 dark:text-slate-500">
                                            —
                                          </span>
                                        )
                                      }
                                    />
                                  </td>
                                </tr>
                              )
                            })}
                          />
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_160f89cd8c897b" />
                  </p>
                )
              }
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
