import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { attachments, reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { PageHeader } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { GeneratedText } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { loadScheduleFormData } from '../_data'
import { BeaconScheduleForm } from '../_schedule-form'
import { toSchedule } from '../page'
import { BeaconReportRunHistory } from './_run-history.client'

const PER_PAGE = 25

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const tGenerated = await getGeneratedTranslations()
  const queryParams = await searchParams
  const query = typeof queryParams.q === 'string' ? queryParams.q.trim() : ''
  const status =
    queryParams.status === 'queued' ||
    queryParams.status === 'running' ||
    queryParams.status === 'succeeded' ||
    queryParams.status === 'failed'
      ? queryParams.status
      : 'all'
  const page = Math.max(1, Number(typeof queryParams.page === 'string' ? queryParams.page : 1) || 1)
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  const runWhere = and(
    eq(reportRuns.tenantId, ctx.tenantId!),
    eq(reportRuns.scheduleId, id),
    status === 'all' ? undefined : eq(reportRuns.status, status),
    query
      ? or(
          ilike(reportRuns.error, `%${query}%`),
          sql`${reportRuns.trigger}::text ILIKE ${`%${query}%`}`,
        )
      : undefined,
  )
  const [{ definitions, members }, schedule, runs, [totalRow]] = await Promise.all([
    loadScheduleFormData(ctx),
    ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(reportSchedules)
        .where(and(eq(reportSchedules.tenantId, ctx.tenantId!), eq(reportSchedules.id, id)))
        .limit(1)
      return row ?? null
    }),
    ctx.db((tx) =>
      tx
        .select({
          id: reportRuns.id,
          scheduleId: reportRuns.scheduleId,
          trigger: reportRuns.trigger,
          status: reportRuns.status,
          error: reportRuns.error,
          rowCount: reportRuns.rowCount,
          startedAt: reportRuns.startedAt,
          finishedAt: reportRuns.finishedAt,
          artifact: {
            filename: attachments.filename,
            sizeBytes: attachments.sizeBytes,
            contentType: attachments.contentType,
            createdAt: attachments.createdAt,
          },
        })
        .from(reportRuns)
        .leftJoin(
          attachments,
          and(
            eq(attachments.tenantId, reportRuns.tenantId),
            eq(attachments.id, reportRuns.pdfAttachmentId),
          ),
        )
        .where(runWhere)
        .orderBy(desc(reportRuns.startedAt))
        .limit(PER_PAGE)
        .offset((page - 1) * PER_PAGE),
    ),
    ctx.db((tx) => tx.select({ value: count() }).from(reportRuns).where(runWhere)),
  ])
  if (!schedule) notFound()
  return (
    <PageContainer className="space-y-6">
      <PageHeader title={schedule.name} description={tGenerated('m_1d998e1c63106a')} />
      <BeaconScheduleForm
        scheduleId={id}
        definitions={definitions}
        members={members}
        initial={toSchedule(schedule)}
        defaultTimezone={schedule.timezone}
      />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          <GeneratedText id="m_1baa4349c5be8c" />
        </h2>
        <BeaconReportRunHistory
          scheduleId={id}
          query={query}
          status={status}
          total={totalRow?.value ?? 0}
          page={page}
          runs={runs.map((run) => ({
            ...run,
            artifact: run.artifact
              ? {
                  ...run.artifact,
                  href: can(ctx, 'reports.read')
                    ? `/reports/schedules/${id}/runs/${run.id}/pdf`
                    : undefined,
                }
              : null,
          }))}
        />
      </section>
    </PageContainer>
  )
}
