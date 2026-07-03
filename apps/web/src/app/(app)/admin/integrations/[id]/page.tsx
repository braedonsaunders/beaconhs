// /admin/integrations/[id] — configure one connection: credentials, the
// source→canonical mapping (live DB browser / CSV / Nango), schedule, and run
// history.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, desc, eq, isNull } from 'drizzle-orm'
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
import { PageContainer } from '@/components/page-layout'
import { RunPill, StatusPill } from '../_pills'
import { DbMapper } from './_db-mapper'
import { NangoConnect } from './_nango-connect'
import {
  previewNow,
  renameConnection,
  runNow,
  saveConfig,
  saveCsv,
  saveSchedule,
  saveSyncPolicy,
} from '../_actions'

export const metadata = { title: 'Connection' }
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

export default async function ConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  const runs = await ctx.db((tx) =>
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
      .where(eq(syncRuns.connectionId, id))
      .orderBy(desc(syncRuns.startedAt))
      .limit(15),
  )

  const hasSettingsForm =
    (summary?.configFields.length ?? 0) > 0 || (summary?.secretFields.length ?? 0) > 0
  const syncPolicy =
    (config.syncPolicy as { missing?: string; ownership?: string } | undefined) ?? {}

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/admin/integrations"
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              ← Integrations
            </Link>
            <form action={renameConnection} className="mt-1 flex items-center gap-2">
              <input type="hidden" name="id" value={conn.id} />
              <input
                name="name"
                defaultValue={conn.name}
                aria-label="Connection name"
                className="max-w-[16rem] min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-2xl font-semibold text-slate-900 hover:border-slate-200 focus:border-teal-400 focus:bg-white focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-900"
              />
              <StatusPill status={conn.status} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                Save
              </Button>
            </form>
            <p className="text-sm text-slate-500">{summary?.name ?? conn.connectorKey}</p>
          </div>
          {summary ? (
            <div className="flex flex-wrap items-center gap-2">
              <form action={previewNow}>
                <input type="hidden" name="id" value={conn.id} />
                <Button type="submit" variant="outline">
                  <Eye size={14} /> Preview
                </Button>
              </form>
              <form action={runNow}>
                <input type="hidden" name="id" value={conn.id} />
                <Button type="submit" variant="outline">
                  <Play size={14} /> Run now
                </Button>
              </form>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* Connection settings (DB credentials, Nango ids) */}
            {hasSettingsForm && summary ? (
              <Card>
                <CardHeader>
                  <CardTitle>Connection settings</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={saveConfig} className="space-y-3">
                    <input type="hidden" name="id" value={conn.id} />
                    {summary.configFields.map((f) => {
                      const current = config[f.key]
                      return (
                        <div key={f.key} className="space-y-1.5">
                          <Label htmlFor={f.key}>
                            {f.label}
                            {f.required ? ' *' : ''}
                          </Label>
                          {f.type === 'select' ? (
                            <Select
                              id={f.key}
                              name={f.key}
                              defaultValue={current != null ? String(current) : ''}
                            >
                              <option value="">—</option>
                              {(f.options ?? []).map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </Select>
                          ) : f.type === 'boolean' ? (
                            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                              <input
                                type="checkbox"
                                name={f.key}
                                defaultChecked={current === true}
                                className="h-4 w-4 rounded border-slate-300"
                              />
                              Enabled
                            </label>
                          ) : f.type === 'textarea' ? (
                            <Textarea
                              id={f.key}
                              name={f.key}
                              rows={5}
                              defaultValue={current != null ? String(current) : ''}
                              placeholder={f.placeholder}
                              className="font-mono text-xs"
                            />
                          ) : (
                            <Input
                              id={f.key}
                              name={f.key}
                              type={f.type === 'number' ? 'number' : 'text'}
                              defaultValue={current != null ? String(current) : ''}
                              placeholder={f.placeholder}
                            />
                          )}
                          {f.help ? <p className="text-xs text-slate-400">{f.help}</p> : null}
                        </div>
                      )
                    })}
                    {summary.secretFields.map((s) => (
                      <div key={s.key} className="space-y-1.5">
                        <Label htmlFor={s.key}>
                          {s.label}
                          {s.required ? ' *' : ''}
                        </Label>
                        <Input
                          id={s.key}
                          name={s.key}
                          type="password"
                          autoComplete="new-password"
                          placeholder={
                            sealed[s.key] ? '•••••••• (saved — leave blank to keep)' : ''
                          }
                        />
                        {s.help ? <p className="text-xs text-slate-400">{s.help}</p> : null}
                      </div>
                    ))}
                    <div className="flex justify-end">
                      <Button type="submit">Save settings</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            {/* Connector-specific mapping surface */}
            {conn.connectorKey === 'database' ? (
              <DbMapper
                connectionId={conn.id}
                dbKind={String(config.dbKind ?? '')}
                entities={summary?.entities ?? []}
                initialMappings={(config.mappings as Record<string, unknown> | undefined) ?? {}}
              />
            ) : null}

            {conn.connectorKey === 'csv' ? (
              <Card>
                <CardHeader>
                  <CardTitle>CSV import</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={saveCsv} className="space-y-3">
                    <input type="hidden" name="id" value={conn.id} />
                    <div className="space-y-1.5">
                      <Label htmlFor="entity">Import as</Label>
                      <Select
                        id="entity"
                        name="entity"
                        defaultValue={String(config.entity ?? 'people')}
                      >
                        {(summary?.entities ?? []).map((e) => (
                          <option key={e} value={e}>
                            {ENTITY_LABELS[e] ?? e}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="csv">CSV data</Label>
                      <Textarea
                        id="csv"
                        name="csv"
                        rows={10}
                        className="font-mono text-xs"
                        defaultValue={String(config.csv ?? '')}
                        placeholder="firstName,lastName,employeeNo,email&#10;Ada,Lovelace,E-001,ada@example.com"
                      />
                      <p className="text-xs text-slate-400">
                        First row is the header. Columns are auto-matched to fields (e.g.{' '}
                        <code>first name</code>, <code>employee no</code>, <code>asset tag</code>).
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="idColumn">ID column (optional)</Label>
                      <Input
                        id="idColumn"
                        name="idColumn"
                        defaultValue={String(config.idColumn ?? '')}
                        placeholder="A stable unique column, e.g. employeeNo"
                      />
                      <p className="text-xs text-slate-400">
                        Used to match rows on re-import. Defaults to the natural key.
                      </p>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit">Save</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            {conn.connectorKey === 'nango' ? (
              <NangoConnect
                connectionId={conn.id}
                connected={Boolean(config.connectionId)}
                nangoConnectionId={String(config.connectionId ?? '')}
                integrationId={String(config.integrationId ?? '')}
                entities={summary?.entities ?? []}
                initialModels={(config.models as Record<string, string> | undefined) ?? {}}
              />
            ) : null}

            {/* Run history */}
            <Card>
              <CardHeader>
                <CardTitle>Run history</CardTitle>
              </CardHeader>
              <CardContent>
                {runs.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No runs yet. Use “Run now” or set a schedule.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {runs.map((r) => (
                      <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <RunPill status={r.status} />
                            <span className="text-xs text-slate-400">{r.trigger}</span>
                            {r.dryRun ? (
                              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30">
                                preview
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{statSummary(r.stats)}</p>
                          {r.error ? (
                            <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                              {r.error}
                            </p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right text-[11px] text-slate-400">
                          <div>{new Date(r.startedAt).toLocaleString()}</div>
                          {r.durationMs != null ? (
                            <div>{(r.durationMs / 1000).toFixed(1)}s</div>
                          ) : null}
                          <Link
                            href={`/admin/integrations/${conn.id}/runs/${r.id}`}
                            className="mt-1 inline-block text-teal-600 hover:text-teal-700"
                          >
                            Review
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Schedule */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock size={16} /> Schedule
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={saveSchedule} className="space-y-3">
                  <input type="hidden" name="id" value={conn.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor="schedule">Run automatically</Label>
                    <Select id="schedule" name="schedule" defaultValue={conn.schedule ?? 'manual'}>
                      <option value="manual">Manual only</option>
                      <option value="15min">Every 15 minutes</option>
                      <option value="hourly">Hourly</option>
                      <option value="6h">Every 6 hours</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={conn.enabled}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Enabled
                  </label>
                  <div className="flex justify-end">
                    <Button type="submit" variant="outline" size="sm">
                      Save schedule
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How it works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  Records are matched on a stable key, so re-running updates existing rows instead
                  of duplicating.
                </p>
                <p>
                  Missing source records are{' '}
                  {syncPolicy.missing === 'archive'
                    ? 'archived after full pulls.'
                    : 'left untouched.'}
                </p>
                <p className="text-xs text-slate-400">
                  Connector: <strong>{summary?.name ?? conn.connectorKey}</strong> ·{' '}
                  {(summary?.entities ?? []).map((e) => ENTITY_LABELS[e] ?? e).join(', ')}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 size={16} /> Sync policy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={saveSyncPolicy} className="space-y-3">
                  <input type="hidden" name="id" value={conn.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor="ownership">Field ownership</Label>
                    <Select
                      id="ownership"
                      name="ownership"
                      defaultValue={
                        syncPolicy.ownership === 'manual_wins' ? 'manual_wins' : 'source_wins'
                      }
                    >
                      <option value="source_wins">Source updates mapped fields</option>
                      <option value="manual_wins">Flag local edits as conflicts</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="missing">Missing source records</Label>
                    <Select
                      id="missing"
                      name="missing"
                      defaultValue={syncPolicy.missing === 'archive' ? 'archive' : 'keep'}
                    >
                      <option value="keep">Keep BeaconHS rows</option>
                      <option value="archive">Archive after full pulls</option>
                    </Select>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" variant="outline" size="sm">
                      Save policy
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
