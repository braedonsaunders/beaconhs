// Right pane of the reports hub. With a report selected it runs the report
// (small row cap) and paginates the printed document live; with nothing
// selected it shows the module overview — stats, schedules, and recent
// deliveries.

import Link from 'next/link'
import { asc, desc, eq } from 'drizzle-orm'
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
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Pencil,
  Sparkles,
} from 'lucide-react'
import { reportDefinitions, reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import {
  buildReportDocumentCss,
  buildReportPageCss,
  renderReportDocumentBodyHtml,
  resolveReportLayout,
} from '@beaconhs/reports'
import type { ReportDefinitionRow } from '../_definitions'
import { loadTenantBranding, runReportForViewer } from '../_run'
import { formatCadence, formatDateTime, CategoryBadge, KindBadge, StatusBadge } from '../_format'
import { ReportPagedPreview } from '../_components/report-paged-preview.client'
import { hubHref } from './definition-list'

/** Rows in the hub's live preview — enough to show real pagination without
 *  making every list click run a heavy query. Open the report for more. */
const HUB_PREVIEW_MAX_ROWS = 50

export async function PreviewPane({
  ctx,
  definition,
  listParams,
  counts,
}: {
  ctx: RequestContext
  definition: ReportDefinitionRow | null
  listParams: Record<string, string | undefined>
  counts: { builtIn: number; custom: number }
}) {
  if (!definition) return <OverviewPane ctx={ctx} counts={counts} />

  const [run, branding] = await Promise.all([
    runReportForViewer(ctx, definition, { maxRows: HUB_PREVIEW_MAX_ROWS }),
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
  const truncated = run.result.rowCount >= HUB_PREVIEW_MAX_ROWS

  const canSchedule = can(ctx, 'reports.schedule')
  const canBuild = can(ctx, 'reports.builder')
  const editHref =
    definition.kind === 'custom'
      ? `/reports/definitions/${definition.id}/edit`
      : `/reports/definitions/new?from=${definition.id}`
  const exportBase = `/reports/definitions/${definition.id}/export?format=`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4 dark:border-slate-800 dark:bg-slate-900">
        <Link
          href={hubHref(listParams) as never}
          className="mb-1.5 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 md:hidden dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeft size={13} />
          All reports
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/reports/definitions/${definition.id}` as never}
                className="truncate text-sm font-semibold text-slate-900 hover:underline dark:text-slate-100"
              >
                {definition.name}
              </Link>
              <KindBadge kind={definition.kind} />
              <CategoryBadge category={definition.category} />
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
              {definition.description ?? run.rangeLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <a href={`${exportBase}csv`}>
              <Button variant="outline" size="sm">
                <Download size={13} className="mr-1.5" />
                CSV
              </Button>
            </a>
            <a href={`${exportBase}xlsx`}>
              <Button variant="outline" size="sm">
                <FileSpreadsheet size={13} className="mr-1.5" />
                Excel
              </Button>
            </a>
            <a href={`${exportBase}pdf`}>
              <Button variant="outline" size="sm">
                <FileText size={13} className="mr-1.5" />
                PDF
              </Button>
            </a>
            {canSchedule ? (
              <Link href={`/reports/schedules/new?definitionId=${definition.id}`}>
                <Button variant="outline" size="sm">
                  <Calendar size={13} className="mr-1.5" />
                  Subscribe
                </Button>
              </Link>
            ) : null}
            {canBuild ? (
              <Link href={editHref as never}>
                <Button variant="outline" size="sm">
                  <Pencil size={13} className="mr-1.5" />
                  Edit
                </Button>
              </Link>
            ) : null}
            <Link href={`/reports/definitions/${definition.id}` as never}>
              <Button size="sm">
                <ArrowUpRight size={13} className="mr-1.5" />
                Open
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {run.error ? (
          <div className="p-3 sm:p-6">
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
                ? `Preview shows the first ${HUB_PREVIEW_MAX_ROWS} rows — open the report for the full document.`
                : null
            }
          />
        )}
      </div>
    </div>
  )
}

// --- Overview (nothing selected) ---------------------------------------------

async function OverviewPane({
  ctx,
  counts,
}: {
  ctx: RequestContext
  counts: { builtIn: number; custom: number }
}) {
  const [schedules, lastRuns] = await ctx.db(async (tx) => {
    const s = await tx
      .select({ schedule: reportSchedules, definition: reportDefinitions })
      .from(reportSchedules)
      .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))
      .orderBy(asc(reportSchedules.name))
    const r = await tx
      .select({ run: reportRuns, schedule: reportSchedules, definition: reportDefinitions })
      .from(reportRuns)
      .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
      .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))
      .orderBy(desc(reportRuns.startedAt))
      .limit(5)
    return [s, r] as const
  })
  const activeSchedules = schedules.filter((s) => s.schedule.active)

  return (
    <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-4 p-3 sm:p-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Select a report on the left to preview the printed document.
        </p>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            label="Active schedules"
            value={activeSchedules.length}
            href="/reports/schedules?status=active"
            icon={<Calendar size={16} />}
          />
          <StatCard
            label="Built-in reports"
            value={counts.builtIn}
            href="/reports?kind=built_in"
            icon={<FileText size={16} />}
          />
          <StatCard
            label="Custom reports"
            value={counts.custom}
            href="/reports?kind=custom"
            icon={<Sparkles size={16} />}
          />
          <StatCard
            label="Recent deliveries"
            value={lastRuns.length}
            href="/reports/schedules"
            icon={<History size={16} />}
          />
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Your schedules</CardTitle>
            <Link
              href="/reports/schedules"
              className="flex items-center gap-1 text-xs text-teal-700 hover:underline dark:text-teal-300"
            >
              View all <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            {schedules.length === 0 ? (
              <EmptyState
                icon={<Calendar size={24} />}
                title="No schedules"
                description="Subscribe to a report to receive it by email on a recurring schedule."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Cadence</TableHead>
                    <TableHead>Next run</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.slice(0, 5).map(({ schedule, definition }) => (
                    <TableRow key={schedule.id}>
                      <TableCell>
                        <Link
                          href={`/reports/schedules/${schedule.id}`}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {schedule.name}
                        </Link>
                        <div className="text-xs text-slate-400">{definition.name}</div>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300">
                        {formatCadence(
                          schedule.cadence,
                          schedule.dayOfWeek,
                          schedule.dayOfMonth,
                          schedule.hour,
                          schedule.minute,
                          schedule.timezone,
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300">
                        {schedule.nextRunAt && schedule.active
                          ? formatDateTime(schedule.nextRunAt)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {schedule.active ? (
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
            <CardTitle className="text-sm">Recent deliveries</CardTitle>
          </CardHeader>
          <CardContent>
            {lastRuns.length === 0 ? (
              <EmptyState
                icon={<History size={24} />}
                title="No deliveries"
                description="Completed runs and their PDFs appear here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rows</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lastRuns.map(({ run, schedule, definition }) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link
                          href={`/reports/schedules/${run.scheduleId}/runs/${run.id}`}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {definition.name}
                        </Link>
                        <div className="text-xs text-slate-400">{schedule.name}</div>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300">
                        {formatDateTime(run.startedAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300">
                        {run.rowCount ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  href,
  icon,
}: {
  label: string
  value: number
  href: string
  icon: React.ReactNode
}) {
  return (
    <Link href={href as never}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="tracking-wide uppercase">{label}</span>
            <span className="text-slate-400">{icon}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        </CardContent>
      </Card>
    </Link>
  )
}
