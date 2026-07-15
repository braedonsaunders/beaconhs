import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// /admin/integrations/[id] — configure one connection: credentials, the
// source→canonical mapping (live DB browser / CSV / Nango), schedule, and run
// history.

import Link from 'next/link'
import { SmartBackLink } from '@/components/smart-back-link'
import { notFound, redirect } from 'next/navigation'
import { and, count, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import { Clock, Eye, Play, Settings2 } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { type SyncEntityStat, syncConnections, syncRuns } from '@beaconhs/db/schema'
import { getConnector, toConnectorSummary } from '@beaconhs/sync'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'
import { RunPill } from '../_pills'
import { DbMapper } from './_db-mapper'
import { NangoConnect } from './_nango-connect'
import { previewNow, runNow, saveConfig, saveCsv, saveSchedule, saveSyncPolicy } from '../_actions'
import { ConnectionNameForm } from './_connection-name-form'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_082f7fa9df4923') }
}
export const dynamic = 'force-dynamic'

const ENTITY_LABELS: Record<string, string> = {
  people: 'People',
  org_unit: 'Locations & Projects',
  equipment: 'Equipment',
}

function statSummary(stats: Record<string, SyncEntityStat>): string {
  const parts: string[] = []
  for (const [entity, s] of Object.entries(stats)) {
    const bits: string[] = []
    if (s.created) bits.push(`+${s.created}`)
    if (s.updated) bits.push(`~${s.updated}`)
    if (s.archived) bits.push(`${s.archived} archived`)
    if (s.conflict) bits.push(`${s.conflict} conflicts`)
    if (s.skipped) bits.push(`${s.skipped} skipped`)
    if (s.failed) bits.push(`${s.failed} failed`)
    parts.push(`${ENTITY_LABELS[entity] ?? entity}: ${bits.length ? bits.join(' ') : 'no change'}`)
  }
  return parts.join(' · ') || 'no records'
}

const RUN_SORTS = ['started'] as const

export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const runParams = parseListParams(sp, {
    sort: 'started',
    dir: 'desc',
    perPage: 15,
    allowedSorts: RUN_SORTS,
  })
  const requestedRunStatus = pickString(sp.runStatus)
  const runStatus =
    requestedRunStatus === 'running' ||
    requestedRunStatus === 'success' ||
    requestedRunStatus === 'partial' ||
    requestedRunStatus === 'error'
      ? requestedRunStatus
      : undefined
  const requestedRunType = pickString(sp.runType)
  const runType =
    requestedRunType === 'preview' || requestedRunType === 'live' ? requestedRunType : undefined

  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.integrations.manage')) redirect('/admin')

  const conn = await ctx.db(async (tx) => {
    const [c] = await tx
      .select()
      .from(syncConnections)
      .where(and(eq(syncConnections.id, id), isNull(syncConnections.deletedAt)))
      .limit(1)
    return c ?? null
  })
  if (!conn) notFound()

  const connector = getConnector(conn.connectorKey)
  const summary = connector ? toConnectorSummary(connector) : null
  const config = (conn.config as Record<string, unknown>) ?? {}
  const sealed = (conn.secrets as Record<string, { ciphertext: string; nonce: string }>) ?? {}

  const runData = await ctx.db(async (tx) => {
    const baseWhere = eq(syncRuns.connectionId, id)
    const filteredWhere = and(
      baseWhere,
      runParams.q
        ? or(
            ilike(syncRuns.trigger, `%${runParams.q}%`),
            ilike(syncRuns.status, `%${runParams.q}%`),
            ilike(syncRuns.error, `%${runParams.q}%`),
          )
        : undefined,
      runStatus ? eq(syncRuns.status, runStatus) : undefined,
      runType ? eq(syncRuns.dryRun, runType === 'preview') : undefined,
    )
    const [totalRows, filteredRows, rows] = await Promise.all([
      tx.select({ count: count() }).from(syncRuns).where(baseWhere),
      tx.select({ count: count() }).from(syncRuns).where(filteredWhere),
      tx
        .select({
          id: syncRuns.id,
          trigger: syncRuns.trigger,
          dryRun: syncRuns.dryRun,
          status: syncRuns.status,
          startedAt: syncRuns.startedAt,
          durationMs: syncRuns.durationMs,
          stats: syncRuns.stats,
          error: syncRuns.error,
        })
        .from(syncRuns)
        .where(filteredWhere)
        .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
        .limit(runParams.perPage)
        .offset((runParams.page - 1) * runParams.perPage),
    ])
    return {
      rows,
      total: Number(totalRows[0]?.count ?? 0),
      filteredTotal: Number(filteredRows[0]?.count ?? 0),
    }
  })

  const hasSettingsForm =
    (summary?.configFields.length ?? 0) > 0 || (summary?.secretFields.length ?? 0) > 0
  const syncPolicy =
    (config.syncPolicy as { missing?: string; ownership?: string } | undefined) ?? {}

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SmartBackLink
              href="/admin/integrations"
              label={tGenerated('m_1cff4ed9a7e699')}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            />
            <ConnectionNameForm id={conn.id} name={conn.name} status={conn.status} />
            <p className="text-sm text-slate-500">
              <GeneratedValue value={summary?.name ?? conn.connectorKey} />
            </p>
          </div>
          <GeneratedValue
            value={
              summary ? (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={previewNow}>
                    <input type="hidden" name="id" value={conn.id} />
                    <Button type="submit" variant="outline">
                      <Eye size={14} /> <GeneratedText id="m_11d37007232de5" />
                    </Button>
                  </form>
                  <form action={runNow}>
                    <input type="hidden" name="id" value={conn.id} />
                    <Button type="submit" variant="outline">
                      <Play size={14} /> <GeneratedText id="m_088d61d7784bcf" />
                    </Button>
                  </form>
                </div>
              ) : null
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* Connection settings (DB credentials, Nango ids) */}
            <GeneratedValue
              value={
                hasSettingsForm && summary ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <GeneratedText id="m_15acc972ef5c8d" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <form action={saveConfig} className="space-y-3">
                        <input type="hidden" name="id" value={conn.id} />
                        <GeneratedValue
                          value={summary.configFields.map((f) => {
                            const current = config[f.key]
                            return (
                              <div key={f.key} className="space-y-1.5">
                                <Label htmlFor={f.key}>
                                  <GeneratedValue value={f.label} />
                                  <GeneratedValue value={f.required ? ' *' : ''} />
                                </Label>
                                <GeneratedValue
                                  value={
                                    f.type === 'select' ? (
                                      <Select
                                        id={f.key}
                                        name={f.key}
                                        defaultValue={current != null ? String(current) : ''}
                                      >
                                        <option value="">—</option>
                                        <GeneratedValue
                                          value={(f.options ?? []).map((o) => (
                                            <option key={o.value} value={o.value}>
                                              {o.label}
                                            </option>
                                          ))}
                                        />
                                      </Select>
                                    ) : f.type === 'boolean' ? (
                                      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                        <input
                                          type="checkbox"
                                          name={f.key}
                                          defaultChecked={current === true}
                                          className="h-4 w-4 rounded border-slate-300"
                                        />
                                        <GeneratedText id="m_0dd399c5304eb6" />
                                      </label>
                                    ) : f.type === 'textarea' ? (
                                      <Textarea
                                        id={f.key}
                                        name={f.key}
                                        rows={5}
                                        defaultValue={current != null ? String(current) : ''}
                                        placeholder={tGeneratedValue(f.placeholder)}
                                        className="font-mono text-xs"
                                      />
                                    ) : (
                                      <Input
                                        id={f.key}
                                        name={f.key}
                                        type={f.type === 'number' ? 'number' : 'text'}
                                        defaultValue={current != null ? String(current) : ''}
                                        placeholder={tGeneratedValue(f.placeholder)}
                                      />
                                    )
                                  }
                                />
                                <GeneratedValue
                                  value={
                                    f.help ? (
                                      <p className="text-xs text-slate-400">
                                        <GeneratedValue value={f.help} />
                                      </p>
                                    ) : null
                                  }
                                />
                              </div>
                            )
                          })}
                        />
                        <GeneratedValue
                          value={summary.secretFields.map((s) => (
                            <div key={s.key} className="space-y-1.5">
                              <Label htmlFor={s.key}>
                                <GeneratedValue value={s.label} />
                                <GeneratedValue value={s.required ? ' *' : ''} />
                              </Label>
                              <Input
                                id={s.key}
                                name={s.key}
                                type="password"
                                autoComplete="new-password"
                                placeholder={tGeneratedValue(
                                  sealed[s.key] ? tGenerated('m_180cbe39790e54') : '',
                                )}
                              />
                              <GeneratedValue
                                value={
                                  s.help ? (
                                    <p className="text-xs text-slate-400">
                                      <GeneratedValue value={s.help} />
                                    </p>
                                  ) : null
                                }
                              />
                            </div>
                          ))}
                        />
                        <div className="flex justify-end">
                          <Button type="submit">
                            <GeneratedText id="m_0bdcc953ae29cd" />
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                ) : null
              }
            />

            {/* Connector-specific mapping surface */}
            <GeneratedValue
              value={
                conn.connectorKey === 'database' ? (
                  <DbMapper
                    connectionId={conn.id}
                    dbKind={String(config.dbKind ?? '')}
                    entities={summary?.entities ?? []}
                    initialMappings={(config.mappings as Record<string, unknown> | undefined) ?? {}}
                  />
                ) : null
              }
            />

            <GeneratedValue
              value={
                conn.connectorKey === 'csv' ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <GeneratedText id="m_1c453560e8e4e5" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <form action={saveCsv} className="space-y-3">
                        <input type="hidden" name="id" value={conn.id} />
                        <div className="space-y-1.5">
                          <Label htmlFor="entity">
                            <GeneratedText id="m_1b3ee576ec9b04" />
                          </Label>
                          <Select
                            id="entity"
                            name="entity"
                            defaultValue={String(config.entity ?? 'people')}
                          >
                            <GeneratedValue
                              value={(summary?.entities ?? []).map((e) => (
                                <option key={e} value={e}>
                                  <GeneratedValue value={ENTITY_LABELS[e] ?? e} />
                                </option>
                              ))}
                            />
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="csv">
                            <GeneratedText id="m_1f2c5316c8d6b3" />
                          </Label>
                          <Textarea
                            id="csv"
                            name="csv"
                            rows={10}
                            className="font-mono text-xs"
                            defaultValue={String(config.csv ?? '')}
                            placeholder={tGenerated('m_04b985f2056642')}
                          />
                          <p className="text-xs text-slate-400">
                            <GeneratedText id="m_032fc8d5305d5b" />
                            <GeneratedValue value={' '} />
                            <code>first name</code>, <code>employee no</code>,{' '}
                            <code>asset tag</code>).
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="idColumn">
                            <GeneratedText id="m_026506a2e6a5d3" />
                          </Label>
                          <Input
                            id="idColumn"
                            name="idColumn"
                            defaultValue={String(config.idColumn ?? '')}
                            placeholder={tGenerated('m_190e0a7ce2162a')}
                          />
                          <p className="text-xs text-slate-400">
                            <GeneratedText id="m_0a149082b4b122" />
                          </p>
                        </div>
                        <div className="flex justify-end">
                          <Button type="submit">
                            <GeneratedText id="m_19e6bff894c3c7" />
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                ) : null
              }
            />

            <GeneratedValue
              value={
                conn.connectorKey === 'nango' ? (
                  <NangoConnect
                    connectionId={conn.id}
                    connected={Boolean(config.connectionId)}
                    nangoConnectionId={String(config.connectionId ?? '')}
                    integrationId={String(config.integrationId ?? '')}
                    entities={summary?.entities ?? []}
                    initialModels={(config.models as Record<string, string> | undefined) ?? {}}
                  />
                ) : null
              }
            />

            {/* Run history */}
            <Card>
              <CardHeader>
                <CardTitle>
                  <GeneratedText id="m_0c0abeaa90bac6" />
                  <GeneratedValue value={runData.total} />)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TableToolbar className="mb-3">
                  <SearchInput placeholder={tGenerated('m_0e73c72a814b7b')} />
                  <FilterChips
                    basePath={`/admin/integrations/${id}`}
                    currentParams={sp}
                    paramKey="runStatus"
                    label={tGenerated('m_0b9da892d6faf0')}
                    options={[
                      { value: 'running', label: 'Running' },
                      { value: 'success', label: 'Success' },
                      { value: 'partial', label: 'Partial' },
                      { value: 'error', label: 'Error' },
                    ]}
                  />
                  <FilterChips
                    basePath={`/admin/integrations/${id}`}
                    currentParams={sp}
                    paramKey="runType"
                    label={tGenerated('m_074ba2f160c506')}
                    options={[
                      { value: 'preview', label: 'Preview' },
                      { value: 'live', label: 'Live' },
                    ]}
                  />
                </TableToolbar>
                <GeneratedValue
                  value={
                    runData.rows.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        <GeneratedValue
                          value={
                            runData.total === 0 ? (
                              <GeneratedText id="m_004bf7e059c46e" />
                            ) : (
                              <GeneratedText id="m_0df40b8e9c9440" />
                            )
                          }
                        />
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        <GeneratedValue
                          value={runData.rows.map((r) => (
                            <li
                              key={r.id}
                              className="flex items-start justify-between gap-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <RunPill status={r.status} />
                                  <span className="text-xs text-slate-400">
                                    <GeneratedValue value={r.trigger} />
                                  </span>
                                  <GeneratedValue
                                    value={
                                      r.dryRun ? (
                                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30">
                                          <GeneratedText id="m_0e06ea082af594" />
                                        </span>
                                      ) : null
                                    }
                                  />
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  <GeneratedValue value={statSummary(r.stats)} />
                                </p>
                                <GeneratedValue
                                  value={
                                    r.error ? (
                                      <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                                        <GeneratedValue value={r.error} />
                                      </p>
                                    ) : null
                                  }
                                />
                              </div>
                              <div className="shrink-0 text-right text-[11px] text-slate-400">
                                <div>
                                  <GeneratedValue
                                    value={formatDateTime(
                                      new Date(r.startedAt),
                                      ctx.timezone,
                                      ctx.locale,
                                    )}
                                  />
                                </div>
                                <GeneratedValue
                                  value={
                                    r.durationMs != null ? (
                                      <div>
                                        <GeneratedValue value={(r.durationMs / 1000).toFixed(1)} />
                                        <GeneratedText id="m_00ded356f0f424" />
                                      </div>
                                    ) : null
                                  }
                                />
                                <Link
                                  href={`/admin/integrations/${conn.id}/runs/${r.id}`}
                                  className="mt-1 inline-block text-teal-600 hover:text-teal-700"
                                >
                                  <GeneratedText id="m_0e315ebf127b18" />
                                </Link>
                              </div>
                            </li>
                          ))}
                        />
                      </ul>
                    )
                  }
                />
                <Pagination
                  basePath={`/admin/integrations/${id}`}
                  currentParams={sp}
                  total={runData.filteredTotal}
                  page={runParams.page}
                  perPage={runParams.perPage}
                />
              </CardContent>
            </Card>
          </div>

          {/* Schedule */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock size={16} /> <GeneratedText id="m_16faf7a86922c4" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={saveSchedule} className="space-y-3">
                  <input type="hidden" name="id" value={conn.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor="schedule">
                      <GeneratedText id="m_146102309d92b9" />
                    </Label>
                    <Select id="schedule" name="schedule" defaultValue={conn.schedule ?? 'manual'}>
                      <option value="manual">
                        <GeneratedText id="m_1697f1ad5a43b8" />
                      </option>
                      <option value="15min">
                        <GeneratedText id="m_0f82a27c0ce443" />
                      </option>
                      <option value="hourly">
                        <GeneratedText id="m_181110e085ca9a" />
                      </option>
                      <option value="6h">
                        <GeneratedText id="m_02a3c95fdee4c2" />
                      </option>
                      <option value="daily">
                        <GeneratedText id="m_014f0a55186cc3" />
                      </option>
                      <option value="weekly">
                        <GeneratedText id="m_0f5fe94677f742" />
                      </option>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={conn.enabled}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <GeneratedText id="m_0dd399c5304eb6" />
                  </label>
                  <div className="flex justify-end">
                    <Button type="submit" variant="outline" size="sm">
                      <GeneratedText id="m_094591d6c7ec4e" />
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <GeneratedText id="m_0e6369fca51e15" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  <GeneratedText id="m_07ee809dd08f1c" />
                </p>
                <p>
                  <GeneratedText id="m_139a88dfcb4df6" />
                  <GeneratedValue value={' '} />
                  <GeneratedValue
                    value={
                      syncPolicy.missing === 'archive' ? (
                        <GeneratedText id="m_0089327db45055" />
                      ) : (
                        <GeneratedText id="m_0d8e28c8edd530" />
                      )
                    }
                  />
                </p>
                <p className="text-xs text-slate-400">
                  <GeneratedText id="m_1b76b31ba13e6b" />{' '}
                  <strong>
                    <GeneratedValue value={summary?.name ?? conn.connectorKey} />
                  </strong>{' '}
                  ·<GeneratedValue value={' '} />
                  <GeneratedValue
                    value={(summary?.entities ?? []).map((e) => ENTITY_LABELS[e] ?? e).join(', ')}
                  />
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 size={16} /> <GeneratedText id="m_04f5150f3bc07d" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={saveSyncPolicy} className="space-y-3">
                  <input type="hidden" name="id" value={conn.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor="ownership">
                      <GeneratedText id="m_01f10f36302149" />
                    </Label>
                    <Select
                      id="ownership"
                      name="ownership"
                      defaultValue={
                        syncPolicy.ownership === 'manual_wins' ? 'manual_wins' : 'source_wins'
                      }
                    >
                      <option value="source_wins">
                        <GeneratedText id="m_11a01c0617b07f" />
                      </option>
                      <option value="manual_wins">
                        <GeneratedText id="m_0c8a8491e1be8e" />
                      </option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="missing">
                      <GeneratedText id="m_05aaaf61d424e3" />
                    </Label>
                    <Select
                      id="missing"
                      name="missing"
                      defaultValue={syncPolicy.missing === 'archive' ? 'archive' : 'keep'}
                    >
                      <option value="keep">
                        <GeneratedText id="m_1f14e28f79f3fa" />
                      </option>
                      <option value="archive">
                        <GeneratedText id="m_0d550cdebb2bff" />
                      </option>
                    </Select>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" variant="outline" size="sm">
                      <GeneratedText id="m_0d15976b151872" />
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
