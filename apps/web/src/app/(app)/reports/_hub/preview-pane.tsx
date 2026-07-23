import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
import { DOCUMENT_PREVIEW_MAX_ROWS, loadTenantBranding, runReportForViewer } from '../_run'
import { formatCadence, CategoryBadge, KindBadge, StatusBadge } from '../_format'
import { formatDateTime } from '@/lib/datetime'
import { ReportPagedPreview } from '../_components/report-paged-preview.client'
import { hubHref } from './definition-list'

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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  if (!definition) return <OverviewPane ctx={ctx} counts={counts} />

  const [run, branding] = await Promise.all([
    runReportForViewer(ctx, definition),
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
    translate: tGeneratedValue,
  })
  const css =
    buildReportPageCss(layout, {
      marginBoxes: { footerLeft: `${branding.name} — ${definition.name}` },
    }) + buildReportDocumentCss(branding.primaryColor, layout.density)
  const truncated = run.result.rowCount >= DOCUMENT_PREVIEW_MAX_ROWS

  const canSchedule = can(ctx, 'reports.schedule')
  const canBuild = can(ctx, 'reports.builder')
  const exportBase = `/reports/definitions/${definition.id}/export?format=`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4 dark:border-slate-800 dark:bg-slate-900">
        <Link
          href={hubHref(listParams) as never}
          className="mb-1.5 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 md:hidden dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeft size={13} />
          <GeneratedText id="m_087e123ab0477c" />
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/reports/definitions/${definition.id}` as never}
                className="truncate text-sm font-semibold text-slate-900 hover:underline dark:text-slate-100"
              >
                <GeneratedValue value={definition.name} />
              </Link>
              <KindBadge kind={definition.kind} />
              <CategoryBadge category={definition.category} />
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
              <GeneratedValue value={definition.description ?? run.rangeLabel} />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <a href={`${exportBase}csv`}>
              <Button variant="outline" size="sm">
                <Download size={13} className="mr-1.5" />
                <GeneratedText id="m_13bc18467bfb44" />
              </Button>
            </a>
            <a href={`${exportBase}xlsx`}>
              <Button variant="outline" size="sm">
                <FileSpreadsheet size={13} className="mr-1.5" />
                <GeneratedText id="m_0c81eece17490f" />
              </Button>
            </a>
            <a href={`${exportBase}pdf`}>
              <Button variant="outline" size="sm">
                <FileText size={13} className="mr-1.5" />
                <GeneratedText id="m_1a2b2ed6729166" />
              </Button>
            </a>
            <GeneratedValue
              value={
                canSchedule ? (
                  <Link href={`/reports/schedules/new?definitionId=${definition.id}`}>
                    <Button variant="outline" size="sm">
                      <Calendar size={13} className="mr-1.5" />
                      <GeneratedText id="m_13104884fca730" />
                    </Button>
                  </Link>
                ) : null
              }
            />
            <GeneratedValue
              value={
                canBuild && definition.kind === 'custom' ? (
                  <Link href={`/reports/definitions/${definition.id}/edit` as never}>
                    <Button variant="outline" size="sm">
                      <Pencil size={13} className="mr-1.5" />
                      <GeneratedText id="m_03a66f9d34ac7b" />
                    </Button>
                  </Link>
                ) : null
              }
            />
            <Link href={`/reports/definitions/${definition.id}` as never}>
              <Button size="sm">
                <ArrowUpRight size={13} className="mr-1.5" />
                <GeneratedText id="m_107ab58c3c38bc" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <GeneratedValue
          value={
            run.error ? (
              <div className="p-3 sm:p-6">
                <Alert variant="destructive">
                  <AlertTitle>
                    <GeneratedText id="m_1cb092500d5ac1" />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedValue value={run.error} />
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <ReportPagedPreview
                bodyHtml={bodyHtml}
                css={css}
                caption={tGeneratedValue(
                  truncated
                    ? tGenerated('m_193ad92cebef87', { value0: DOCUMENT_PREVIEW_MAX_ROWS })
                    : null,
                )}
              />
            )
          }
        />
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
  const tGenerated = await getGeneratedTranslations()
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
          <GeneratedText id="m_1fb239e1fc4416" />
        </p>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            label={tGenerated('m_0cc86809d4118c')}
            value={activeSchedules.length}
            href="/reports/schedules?status=active"
            icon={<Calendar size={16} />}
          />
          <StatCard
            label={tGenerated('m_04ab92ba1e231c')}
            value={counts.builtIn}
            href="/reports?kind=built_in"
            icon={<FileText size={16} />}
          />
          <StatCard
            label={tGenerated('m_1a96c6426aee92')}
            value={counts.custom}
            href="/reports?kind=custom"
            icon={<Sparkles size={16} />}
          />
          <StatCard
            label={tGenerated('m_12c7314ea859a7')}
            value={lastRuns.length}
            href="/reports/schedules"
            icon={<History size={16} />}
          />
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">
              <GeneratedText id="m_001891329096ef" />
            </CardTitle>
            <Link
              href="/reports/schedules"
              className="flex items-center gap-1 text-xs text-teal-700 hover:underline dark:text-teal-300"
            >
              <GeneratedText id="m_099da529c61580" /> <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            <GeneratedValue
              value={
                schedules.length === 0 ? (
                  <EmptyState
                    icon={<Calendar size={24} />}
                    title={tGenerated('m_128e4fb23de822')}
                    description={tGenerated('m_0c1b23b352a39a')}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <GeneratedText id="m_02b18d5c7f6f2d" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_1151ed0308b6d1" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_05e650592b7158" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_0b9da892d6faf0" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <GeneratedValue
                        value={schedules.slice(0, 5).map(({ schedule, definition }) => (
                          <TableRow key={schedule.id}>
                            <TableCell>
                              <Link
                                href={`/reports/schedules/${schedule.id}`}
                                className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                              >
                                <GeneratedValue value={schedule.name} />
                              </Link>
                              <div className="text-xs text-slate-400">
                                <GeneratedValue value={definition.name} />
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              <GeneratedValue
                                value={formatCadence(
                                  schedule.cadence,
                                  schedule.dayOfWeek,
                                  schedule.dayOfMonth,
                                  schedule.hour,
                                  schedule.minute,
                                  schedule.timezone,
                                )}
                              />
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              <GeneratedValue
                                value={
                                  schedule.nextRunAt && schedule.active
                                    ? formatDateTime(
                                        new Date(schedule.nextRunAt),
                                        ctx.timezone,
                                        ctx.locale,
                                      )
                                    : '—'
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <GeneratedValue
                                value={
                                  schedule.active ? (
                                    <Badge variant="success">
                                      <GeneratedText id="m_0af64d5dc843c0" />
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary">
                                      <GeneratedText id="m_18a9844f041430" />
                                    </Badge>
                                  )
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      />
                    </TableBody>
                  </Table>
                )
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              <GeneratedText id="m_12c7314ea859a7" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GeneratedValue
              value={
                lastRuns.length === 0 ? (
                  <EmptyState
                    icon={<History size={24} />}
                    title={tGenerated('m_1b1fe211096b6e')}
                    description={tGenerated('m_0925cadad13709')}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <GeneratedText id="m_0ab5a972fc80fd" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_1922c581498469" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_0b9da892d6faf0" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_03be2202673df4" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <GeneratedValue
                        value={lastRuns.map(({ run, schedule, definition }) => (
                          <TableRow key={run.id}>
                            <TableCell>
                              <Link
                                href={`/reports/schedules/${run.scheduleId}/runs/${run.id}`}
                                className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                              >
                                <GeneratedValue value={definition.name} />
                              </Link>
                              <div className="text-xs text-slate-400">
                                <GeneratedValue value={schedule.name} />
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              <GeneratedValue
                                value={formatDateTime(
                                  new Date(run.startedAt),
                                  ctx.timezone,
                                  ctx.locale,
                                )}
                              />
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={run.status} />
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              <GeneratedValue value={run.rowCount ?? '—'} />
                            </TableCell>
                          </TableRow>
                        ))}
                      />
                    </TableBody>
                  </Table>
                )
              }
            />
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
            <span className="tracking-wide uppercase">
              <GeneratedValue value={label} />
            </span>
            <span className="text-slate-400">
              <GeneratedValue value={icon} />
            </span>
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            <GeneratedValue value={value} />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
