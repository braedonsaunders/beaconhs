import { sql } from 'drizzle-orm'
import {
  complianceObligations,
  complianceStatus,
  ppeItems,
  correctiveActions,
  people,
  tenantNotificationPolicy,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export type DueStatus = 'overdue' | 'expiring' | 'due_soon' | 'booked'
export type DueObligationRow = {
  key: string
  module: typeof complianceObligations.$inferSelect.sourceModule
  subject: string
  personName: string | null
  dueOn: string | null
  status: DueStatus
  href: string
  count: number
  expected: number
}

type QueryRow = {
  id: string | null
  obligation_id: string
  source_module: DueObligationRow['module']
  title: string
  person_name: string | null
  due_on: string | Date | null
  status: DueStatus
  count: number
  expected: number
  total: number | string
  overdue_count: number | string
  expiring_count: number | string
  due_soon_count: number | string
  booked_count: number | string
}

/** The same active, materialized obligations as Overview; never raw maintenance dates. */
export async function listDueObligations(
  ctx: RequestContext,
  options: {
    q?: string
    module?: string
    status?: DueStatus
    sort?: string
    dir?: 'asc' | 'desc'
    page: number
    perPage: number
  },
) {
  const filters = [sql`true`]
  if (options.module) filters.push(sql`source_module = ${options.module}`)
  if (options.status) filters.push(sql`status = ${options.status}`)
  if (options.q?.trim())
    filters.push(
      sql`concat_ws(' ',title,person_name,source_module,status) ilike ${`%${options.q.trim()}%`}`,
    )
  const sort =
    options.sort === 'module'
      ? sql`source_module`
      : options.sort === 'item'
        ? sql`title`
        : options.sort === 'person'
          ? sql`person_name`
          : options.sort === 'due'
            ? sql`due_on`
            : sql`case status when 'overdue' then 0 when 'expiring' then 1 when 'due_soon' then 2 else 3 end`
  const direction = options.dir === 'desc' ? sql`desc` : sql`asc`
  const page = Math.max(1, Math.trunc(options.page))
  const limit = Math.min(100, Math.max(1, Math.trunc(options.perPage)))
  return ctx.db(async (tx) => {
    const result = await tx.execute<QueryRow>(sql`
      with clock as (
        select (now() at time zone coalesce((select ${tenantNotificationPolicy.scanTimezone}
          from ${tenantNotificationPolicy} where ${tenantNotificationPolicy.tenantId} = ${ctx.tenantId}), 'UTC'))::date + 30 as horizon
      ), due as (
        select ${complianceStatus.id} as id, ${complianceObligations.id} as obligation_id,
          ${complianceObligations.sourceModule}::text as source_module, ${complianceObligations.title} as title,
          coalesce(nullif(trim(concat_ws(', ',${people.lastName},${people.firstName})), ''),${ppeItems.serialNumber},${correctiveActions.title}) as person_name,
          ${complianceStatus.dueOn} as due_on, ${complianceStatus.count} as count, ${complianceStatus.expected} as expected,
          case when ${complianceStatus.status} in ('overdue','expiring','booked') then ${complianceStatus.status}::text else 'due_soon' end as status
        from ${complianceStatus}
        join ${complianceObligations} on ${complianceObligations.id} = ${complianceStatus.obligationId}
          and ${complianceObligations.tenantId} = ${complianceStatus.tenantId}
        left join ${people} on ${people.id} = ${complianceStatus.personId} and ${people.tenantId} = ${complianceStatus.tenantId}
        left join ${ppeItems} on ${ppeItems.id}::text = ${complianceStatus.subjectRef}->>'recordId' and ${ppeItems.tenantId}=${complianceStatus.tenantId} and ${complianceObligations.sourceModule}='ppe_inspection'
        left join ${correctiveActions} on ${correctiveActions.id}::text = ${complianceStatus.subjectRef}->>'caId' and ${correctiveActions.tenantId}=${complianceStatus.tenantId} and ${complianceObligations.sourceModule}='corrective_action'
        cross join clock
        where ${complianceStatus.tenantId} = ${ctx.tenantId} and ${complianceObligations.status} = 'active'
          and ${complianceObligations.deletedAt} is null
          and (${complianceStatus.personId} is null or (${people.status} = 'active' and ${people.deletedAt} is null
            and (${complianceObligations.workerType} = 'all' or ${people.metadata}->>'personType' = ${complianceObligations.workerType})))
          and (${complianceStatus.status} in ('overdue','expiring','booked') or (
            ${complianceStatus.status} in ('pending','in_progress') and ${complianceStatus.dueOn} <= clock.horizon))
      ), filtered as (select * from due where ${sql.join(filters, sql` and `)}),
      totals as (select count(*) as total from filtered),
      counts as (select count(*) filter(where status='overdue') as overdue_count,
        count(*) filter(where status='expiring') as expiring_count,
        count(*) filter(where status='due_soon') as due_soon_count,
        count(*) filter(where status='booked') as booked_count from due),
      paged as (select * from filtered order by ${sort} ${direction} nulls last, due_on asc nulls last, title, id limit ${limit} offset ${(page - 1) * limit})
      select paged.*, totals.total, counts.* from totals cross join counts left join paged on true
    `)
    const rows = result
    const head = rows[0]
    return {
      total: Number(head?.total ?? 0),
      counts: {
        overdue: Number(head?.overdue_count ?? 0),
        expiring: Number(head?.expiring_count ?? 0),
        due_soon: Number(head?.due_soon_count ?? 0),
        booked: Number(head?.booked_count ?? 0),
      },
      rows: rows
        .filter((row) => row.id !== null)
        .map(
          (row) =>
            ({
              key: row.id!,
              module: row.source_module,
              subject: row.title,
              personName: row.person_name,
              dueOn:
                row.due_on instanceof Date ? row.due_on.toISOString().slice(0, 10) : row.due_on,
              status: row.status,
              href: `/compliance/obligations/${row.obligation_id}`,
              count: row.count,
              expected: row.expected,
            }) satisfies DueObligationRow,
        ),
    }
  })
}
