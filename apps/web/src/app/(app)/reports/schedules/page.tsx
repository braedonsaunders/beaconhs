import { and, asc, count, eq, ilike, or } from 'drizzle-orm'
import { reportSchedules } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import type { ReportSchedule } from '@beaconhs/reports'
import { PageHeader } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { ReportsSubNav } from '../_nav'
import { loadScheduleFormData } from './_data'
import { BeaconScheduleList } from './_schedule-list.client'

export const dynamic = 'force-dynamic'
const PER_PAGE = 25

export default async function ReportSchedulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q.trim() : ''
  const status = params.status === 'active' || params.status === 'paused' ? params.status : 'all'
  const page = Math.max(1, Number(typeof params.page === 'string' ? params.page : 1) || 1)
  const predicates = [
    eq(reportSchedules.tenantId, ctx.tenantId!),
    status === 'all' ? undefined : eq(reportSchedules.active, status === 'active'),
    query
      ? or(ilike(reportSchedules.name, `%${query}%`), ilike(reportSchedules.timezone, `%${query}%`))
      : undefined,
  ].filter(Boolean)
  const where = and(...predicates)
  const [{ definitions }, schedules, [totalRow]] = await Promise.all([
    loadScheduleFormData(ctx),
    ctx.db((tx) =>
      tx
        .select()
        .from(reportSchedules)
        .where(where)
        .orderBy(asc(reportSchedules.name))
        .limit(PER_PAGE)
        .offset((page - 1) * PER_PAGE),
    ),
    ctx.db((tx) => tx.select({ value: count() }).from(reportSchedules).where(where)),
  ])
  const canManage = ctx.isSuperAdmin || can(ctx, 'reports.schedule')

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_1a3a0b97daa2bd')}
            description={tGenerated('m_02e3bf6d91eb5b')}
          />
          <ReportsSubNav active="schedules" />
        </>
      }
    >
      <BeaconScheduleList
        schedules={schedules.map(toSchedule)}
        definitions={definitions}
        query={query}
        status={status}
        total={totalRow?.value ?? 0}
        page={page}
        canManage={canManage}
      />
    </ListPageLayout>
  )
}

function toSchedule(row: typeof reportSchedules.$inferSelect): ReportSchedule {
  return {
    schemaVersion: 1,
    id: row.id,
    definitionId: row.definitionId,
    name: row.name,
    active: row.active,
    cadence: row.cadence,
    timezone: row.timezone,
    hour: row.hour,
    minute: row.minute,
    dayOfWeek: row.dayOfWeek,
    dayOfMonth: row.dayOfMonth,
    weekOfMonth: row.weekOfMonth as 1 | 2 | 3 | 4 | 5 | null,
    repeatEvery: row.repeatEvery,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    recipientUserIds: row.recipientUserIds,
    recipientEmails: row.recipientEmails,
    filters: row.filters,
    emailSubject: row.emailSubject,
    emailMessage: row.emailMessage,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
  }
}

export { toSchedule }
