// Report viewer — a true print preview. Runs the definition in-app (same
// engine and same document template as scheduled PDFs) and paginates it into
// real paper pages with Paged.js, so the screen matches the exported PDF
// page-for-page. The Document tab owns the viewport height; subscriptions,
// run history, and definition details live on the Schedules & activity tab.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { desc, eq, inArray } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import {
  buildReportDocumentCss,
  buildReportPageCss,
  renderReportDocumentBodyHtml,
  resolveReportLayout,
} from '@beaconhs/reports'
import { requireRequestContext } from '@/lib/auth'
import { FadeInHeader } from '@/components/page-layout-motion'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { loadDefinitionById } from '../../_definitions'
import {
  DOCUMENT_PREVIEW_MAX_ROWS,
  VIEWER_RANGE_CHOICES,
  loadTenantBranding,
  runReportForViewer,
} from '../../_run'
import { formatCadence, formatDateTime, CategoryBadge, KindBadge, StatusBadge } from '../../_format'
import { ReportPagedPreview } from '../../_components/report-paged-preview.client'
import { runOnceFromDefinition, deleteDefinition } from './actions'

export const metadata = { title: 'Report' }
export const dynamic = 'force-dynamic'

const TABS = ['document', 'activity'] as const

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

  const tab = pickActiveTab(sp, TABS, 'document')
  const daysParam = typeof sp.days === 'string' ? Number(sp.days) : null

  // Schedules pointing at this definition + their recent runs (tab count +
  // the activity tab body).
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <FadeInHeader className="mx-auto max-w-screen-2xl px-3 pt-3 sm:px-6 sm:pt-5">
          <DetailHeader
            back={{ href: '/reports', label: 'Back to reports' }}
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
          <TabNav
            basePath={`/reports/definitions/${id}`}
            currentParams={sp}
            active={tab}
            className="mt-2.5 sm:mt-4"
            tabs={[
              { key: 'document', label: 'Document' },
              { key: 'activity', label: 'Schedules & activity', count: scheduleRows.length },
            ]}
          />
        </FadeInHeader>
      </div>

      {tab === 'document' ? (
        <DocumentTab ctx={ctx} definition={definition} daysParam={daysParam} sp={sp} />
      ) : (
        <ActivityTab
          definition={definition}
          scheduleRows={scheduleRows}
          runRows={runRows}
          canSchedule={canSchedule}
          canBuild={canBuild}
          isCustom={isCustom}
          editHref={editHref}
          deleteBound={deleteBound}
        />
      )}
    </div>
  )
}

// --- Document tab (print preview) -------------------------------------------

async function DocumentTab({
  ctx,
  definition,
  daysParam,
  sp,
}: {
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
  definition: NonNullable<Awaited<ReturnType<typeof loadDefinitionById>>>
  daysParam: number | null
  sp: Record<string, string | string[] | undefined>
}) {
  const [run, branding] = await Promise.all([
    runReportForViewer(ctx, definition, { days: daysParam }),
    loadTenantBranding(ctx),
  ])

  const layout = resolveReportLayout(definition.layout)
  const bodyHtml = renderReportDocumentBodyHtml({
    tenantName: branding.name,
    tenantLogoUrl: branding.logoUrl,
    primaryColor: branding.primaryColor,
    reportName: definition.name,
    dateRangeLabel: run.rangeLabel,
    generatedAt: new Date(),
    summary: layout.showSummary ? run.result.summary : undefined,
    groups: run.result.groups,
  })
  const css =
    buildReportPageCss(layout, {
      marginBoxes: { footerLeft: `${branding.name} — ${definition.name}` },
    }) + buildReportDocumentCss(branding.primaryColor, layout.density)
  const truncated = run.result.rowCount >= DOCUMENT_PREVIEW_MAX_ROWS

  const exportBase = `/reports/definitions/${definition.id}/export${run.days ? `?days=${run.days}` : ''}`
  const exportJoin = run.days ? '&' : '?'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-200 bg-white px-3 py-2 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-2">
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
                    href={
                      `/reports/definitions/${definition.id}?days=${d}${typeof sp.tab === 'string' ? `&tab=${sp.tab}` : ''}` as never
                    }
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
      </div>

      <div className="min-h-0 flex-1">
        {run.error ? (
          <div className="mx-auto max-w-screen-2xl p-3 sm:p-6">
            <Alert variant="destructive">
              <AlertTitle>This report failed to run</AlertTitle>
              <AlertDescription>{run.error}</AlertDescription>
            </Alert>
          </div>
        ) : (
          <ReportPagedPreview
            bodyHtml={bodyHtml}
            css={css}
            caption={
              truncated
                ? `Preview truncated at ${DOCUMENT_PREVIEW_MAX_ROWS} rows — export PDF for the complete document.`
                : null
            }
          />
        )}
      </div>
    </div>
  )
}

// --- Schedules & activity tab -------------------------------------------------

function ActivityTab({
  definition,
  scheduleRows,
  runRows,
  canSchedule,
  canBuild,
  isCustom,
  editHref,
  deleteBound,
}: {
  definition: NonNullable<Awaited<ReturnType<typeof loadDefinitionById>>>
  scheduleRows: readonly (typeof reportSchedules.$inferSelect)[]
  runRows: readonly (typeof reportRuns.$inferSelect)[]
  canSchedule: boolean
  canBuild: boolean
  isCustom: boolean
  editHref: string
  deleteBound: () => Promise<void>
}) {
  return (
    <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-screen-2xl space-y-4 p-3 sm:p-6">
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
    </div>
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
