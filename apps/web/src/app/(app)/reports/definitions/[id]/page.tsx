// Report viewer — runs the definition in-app (same engine as scheduled PDFs)
// and renders summary cards, charts, and the grouped result tables, with
// range switching, CSV/XLSX export, subscribe, and manage actions.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { desc, eq, inArray } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@beaconhs/ui'
import {
  Calendar,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Mail,
  Pencil,
  Trash2,
} from 'lucide-react'
import { reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { loadDefinitionById } from '../../_definitions'
import { runReportForViewer, VIEWER_RANGE_CHOICES } from '../../_run'
import { formatCadence, formatDateTime, CategoryBadge, KindBadge, StatusBadge } from '../../_format'
import {
  ReportCharts,
  ReportGroupTables,
  ReportRunError,
  ReportSummaryCards,
} from '../../_components/report-results'
import { runOnceFromDefinition, deleteDefinition } from './actions'

export const metadata = { title: 'Report' }
export const dynamic = 'force-dynamic'

export default async function ReportViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await requireRequestContext()

  const definition = await loadDefinitionById(ctx.tenantId!, id)
  if (!definition) notFound()

  const daysParam = typeof sp.days === 'string' ? Number(sp.days) : null
  const run = await runReportForViewer(ctx, definition, { days: daysParam })

  // Schedules pointing at this definition + their recent runs.
  const [scheduleRows, runRows] = await ctx.db(async (tx) => {
    const s = await tx
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.definitionId, id))
      .orderBy(desc(reportSchedules.createdAt))
    if (s.length === 0) return [s, []] as const
    const r = await tx
      .select()
      .from(reportRuns)
      .where(
        inArray(
          reportRuns.scheduleId,
          s.map((row) => row.id),
        ),
      )
      .orderBy(desc(reportRuns.startedAt))
      .limit(10)
    return [s, r] as const
  })

  const canSchedule = can(ctx, 'reports.schedule')
  const canBuild = can(ctx, 'reports.builder')
  const isCustom = definition.kind === 'custom'
  // Every report is editable: custom edits in place; a built-in opens an
  // editable copy you own (the original stays in the catalogue).
  const editHref = isCustom
    ? `/reports/definitions/${id}/edit`
    : `/reports/definitions/new?from=${id}`
  const runBound = runOnceFromDefinition.bind(null, id)
  const deleteBound = deleteDefinition.bind(null, id)
  const exportBase = `/reports/definitions/${id}/export${run.days ? `?days=${run.days}` : ''}`
  const exportJoin = run.days ? '&' : '?'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/reports/definitions', label: 'Back to library' }}
          title={definition.name}
          subtitle={definition.description ?? undefined}
          badge={
            <div className="flex items-center gap-1.5">
              <KindBadge kind={definition.kind} />
              <CategoryBadge category={definition.category} />
            </div>
          }
          actions={
            <>
              {canSchedule ? (
                <form action={runBound}>
                  <Button type="submit" variant="outline" size="sm">
                    <Mail size={14} className="mr-1.5" />
                    Email PDF
                  </Button>
                </form>
              ) : null}
              {canBuild ? (
                <Link href={editHref as never}>
                  <Button variant="outline" size="sm">
                    <Pencil size={14} className="mr-1.5" />
                    Edit
                  </Button>
                </Link>
              ) : null}
              {canSchedule ? (
                <Link href={`/reports/schedules/new?definitionId=${definition.id}`}>
                  <Button size="sm">
                    <Calendar size={14} className="mr-1.5" />
                    Subscribe
                  </Button>
                </Link>
              ) : null}
            </>
          }
        />
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {run.rangeMode === 'as_of' ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{run.rangeLabel}</p>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                {run.rangeMode === 'lookahead' ? 'Next' : 'Last'}
              </span>
              {VIEWER_RANGE_CHOICES.map((d) => {
                const active =
                  (run.days ?? null) === d || (!run.days && isDefaultChoice(d, run.rangeLabel))
                return (
                  <Link
                    key={d}
                    href={`/reports/definitions/${id}?days=${d}` as never}
                    className={cn(
                      'inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
                      active
                        ? 'border-teal-700 bg-teal-700 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60',
                    )}
                  >
                    {d} days
                  </Link>
                )
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-400">
              {run.result.rowCount} row{run.result.rowCount === 1 ? '' : 's'}
            </p>
            <a href={`${exportBase}${exportJoin}format=csv`}>
              <Button variant="outline" size="sm">
                <Download size={14} className="mr-1.5" />
                CSV
              </Button>
            </a>
            <a href={`${exportBase}${exportJoin}format=xlsx`}>
              <Button variant="outline" size="sm">
                <FileSpreadsheet size={14} className="mr-1.5" />
                Excel
              </Button>
            </a>
            <a href={`${exportBase}${exportJoin}format=pdf`}>
              <Button variant="outline" size="sm">
                <FileText size={14} className="mr-1.5" />
                PDF
              </Button>
            </a>
          </div>
        </div>

        {run.error ? (
          <ReportRunError error={run.error} />
        ) : (
          <>
            <ReportSummaryCards summary={run.result.summary} />
            <ReportCharts charts={run.result.charts} />
            <ReportGroupTables groups={run.result.groups} />
          </>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Subscriptions ({scheduleRows.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {scheduleRows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No schedules for this report.
                  {canSchedule ? (
                    <>
                      {' '}
                      <Link
                        href={`/reports/schedules/new?definitionId=${definition.id}`}
                        className="text-teal-700 hover:underline dark:text-teal-300"
                      >
                        Create schedule
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Cadence</TableHead>
                      <TableHead>Next run</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scheduleRows.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Link
                            href={`/reports/schedules/${s.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            {s.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {formatCadence(
                            s.cadence,
                            s.dayOfWeek,
                            s.dayOfMonth,
                            s.hour,
                            s.minute,
                            s.timezone,
                          )}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {s.nextRunAt ? formatDateTime(s.nextRunAt) : '—'}
                        </TableCell>
                        <TableCell>
                          {s.active ? (
                            <Badge variant="success">active</Badge>
                          ) : (
                            <Badge variant="secondary">paused</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent runs</CardTitle>
            </CardHeader>
            <CardContent>
              {runRows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No runs yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>PDF</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link
                            href={`/reports/schedules/${r.scheduleId}/runs/${r.id}`}
                            className="text-slate-700 hover:underline dark:text-slate-200"
                          >
                            {formatDateTime(r.startedAt)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {r.rowCount ?? '—'}
                        </TableCell>
                        <TableCell>
                          {r.pdfAttachmentId ? (
                            <a
                              href={`/reports/schedules/${r.scheduleId}/runs/${r.id}/pdf`}
                              className="text-teal-700 hover:underline dark:text-teal-300"
                            >
                              Download
                            </a>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">About this report</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
              <MetaItem label="Slug">
                <span className="font-mono text-xs">{definition.slug}</span>
              </MetaItem>
              <MetaItem label="Query kind">
                <span className="font-mono text-xs">{definition.queryKind}</span>
              </MetaItem>
              <MetaItem label="Created">{formatDateTime(definition.createdAt)}</MetaItem>
              <MetaItem label="Updated">{formatDateTime(definition.updatedAt)}</MetaItem>
            </dl>
            {canBuild ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                <Link href={editHref as never}>
                  <Button variant="outline" size="sm">
                    <Pencil size={14} className="mr-1.5" />
                    {isCustom ? 'Edit report' : 'Edit a copy'}
                  </Button>
                </Link>
                <Link href={`/reports/definitions/new?from=${definition.id}` as never}>
                  <Button variant="outline" size="sm">
                    <Copy size={14} className="mr-1.5" />
                    Duplicate
                  </Button>
                </Link>
                {isCustom ? (
                  <form action={deleteBound}>
                    <Button type="submit" variant="destructive" size="sm">
                      <Trash2 size={14} className="mr-1.5" />
                      Delete
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </DetailPageLayout>
  )
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  )
}

/** When no explicit ?days= is set the engine used the queryKind default —
 *  highlight the matching pill by reading the computed label. */
function isDefaultChoice(d: number, rangeLabel: string): boolean {
  return rangeLabel.includes(`${d} days`)
}
