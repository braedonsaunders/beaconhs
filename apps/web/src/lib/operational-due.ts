// Native equipment maintenance and skill-ticket dates for operational dashboard widgets.
import { equipmentServiceDueSql } from '@beaconhs/db'
import { complianceDate, resolveComplianceClock } from '@beaconhs/compliance'
import { sql, type SQL } from 'drizzle-orm'
import {
  equipmentServicePlans,
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentReminders,
  equipmentItems,
  equipmentWorkOrders,
  people,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { moduleScopeWhere } from '@beaconhs/tenant/visibility'

export type SignalStatus = 'overdue' | 'expired' | 'due_soon' | 'open'

type SignalModule = 'skills' | 'equipment'

type OperationalDueSignal = {
  key: string
  module: SignalModule
  family: string
  subject: string
  personName: string | null
  personId: string | null
  dueOn: string | null
  status: SignalStatus
  href: string | null
}

const HORIZON_DAYS = 30

function isoDate(d: string | Date | null): string | null {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

type DueSignalListOptions = {
  q?: string
  module?: SignalModule
  status?: SignalStatus
  family?: string
  sort?: 'module' | 'item' | 'person' | 'due' | 'status'
  dir?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

type DueSignalListResult = {
  rows: OperationalDueSignal[]
  total: number
  counts: Record<SignalStatus, number>
}

type SignalQueryRow = {
  stable_key: string | null
  module: SignalModule | null
  family: string | null
  subject: string | null
  person_name: string | null
  person_id: string | null
  due_on: string | Date | null
  status: SignalStatus | null
  href: string | null
  total: string | number
  overdue_count: string | number
  expired_count: string | number
  due_soon_count: string | number
  open_count: string | number
}

/**
 * Native operational dates, independent of configured people obligations,
 * within the horizon (or already past).
 */
export async function listDueSignals(
  ctx: RequestContext,
  options: DueSignalListOptions = {},
): Promise<DueSignalListResult> {
  const tid = ctx.tenantId!
  const today = complianceDate(await ctx.db((tx) => resolveComplianceClock(tx, tid)))
  const horizonDate = new Date(Date.parse(today) + HORIZON_DAYS * 24 * 60 * 60 * 1000)
  const horizonIso = horizonDate.toISOString().slice(0, 10)
  const page = Math.max(1, Math.min(10_000, Math.trunc(options.page ?? 1)))
  const perPage = Math.max(5, Math.min(100, Math.trunc(options.perPage ?? 50)))
  const offset = (page - 1) * perPage
  const filteredConditions: SQL<unknown>[] = []
  if (options.module) filteredConditions.push(sql`module = ${options.module}`)
  if (options.family) filteredConditions.push(sql`family = ${options.family}`)
  if (options.status) filteredConditions.push(sql`status = ${options.status}`)
  const searchQuery = options.q?.trim()
  if (searchQuery) {
    const query = `%${searchQuery}%`
    filteredConditions.push(
      sql`concat_ws(' ', module, family, subject, coalesce(person_name, ''), coalesce(due_on::text, ''), status) ilike ${query}`,
    )
  }
  const filteredWhere =
    filteredConditions.length > 0 ? sql`where ${sql.join(filteredConditions, sql` and `)}` : sql``
  const direction = options.dir === 'desc' ? sql`desc` : sql`asc`
  const sortExpression =
    options.sort === 'module'
      ? sql`module`
      : options.sort === 'item'
        ? sql`subject`
        : options.sort === 'person'
          ? sql`person_name`
          : options.sort === 'due'
            ? sql`due_on`
            : sql`case status when 'overdue' then 0 when 'expired' then 1 when 'due_soon' then 2 else 3 end`
  const orderBy = sql`${sortExpression} ${direction} nulls last,
    case status when 'overdue' then 0 when 'expired' then 1 when 'due_soon' then 2 else 3 end,
    due_on asc nulls last, subject asc, module asc, family asc, stable_key asc`

  return ctx.db(async (tx) => {
    // Dashboard equipment widgets share the module's site/holder visibility.
    const equipmentScope =
      (await moduleScopeWhere(ctx, tx, {
        prefix: 'equipment',
        siteCol: equipmentItems.currentSiteOrgUnitId,
        personCol: equipmentItems.currentHolderPersonId,
      })) ?? sql`true`
    const queryResult = await tx.execute<SignalQueryRow>(sql`
      with signals as (
        select 'equipment'::text as module, 'Inspection'::text as family, ${equipmentItems.assetTag} || ' — ' ||
          coalesce(${equipmentInspectionTypes.name}, ${equipmentInspectionSchedules.label}, 'Inspection') as subject,
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), '') as person_name,
          ${equipmentItems.currentHolderPersonId}::text as person_id, ${equipmentInspectionSchedules.nextDueOn}::date as due_on,
          case when ${equipmentInspectionSchedules.nextDueOn} < ${today}::date then 'overdue' else 'due_soon' end::text as status,
          '/equipment/maintenance?drawer=unit-' || ${equipmentItems.id}::text as href,
          ${equipmentInspectionSchedules.id}::text || ':inspection' as stable_key
        from ${equipmentItems}
        join ${equipmentInspectionSchedules} on ${equipmentInspectionSchedules.equipmentItemId} = ${equipmentItems.id}
          and ${equipmentInspectionSchedules.tenantId} = ${equipmentItems.tenantId}
          and ${equipmentInspectionSchedules.isActive} = true
        left join ${equipmentInspectionTypes} on ${equipmentInspectionTypes.id} = ${equipmentInspectionSchedules.inspectionTypeId}
        left join ${people} on ${people.id} = ${equipmentItems.currentHolderPersonId}
        where ${equipmentItems.tenantId} = ${tid} and ${equipmentItems.deletedAt} is null
          and ${equipmentItems.isDraft} = false and ${equipmentItems.status} not in ('retired','lost') and (${equipmentScope})
          and ${equipmentInspectionSchedules.nextDueOn} <= ${horizonIso}::date

        union all
        select 'equipment', 'Reminder', ${equipmentItems.assetTag} || ' — ' || ${equipmentReminders.title},
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), ''),
          ${equipmentReminders.assignedToPersonId}::text, ${equipmentReminders.dueOn}::date,
          case when ${equipmentReminders.dueOn} < ${today}::date then 'overdue' else 'due_soon' end,
          '/equipment/maintenance?drawer=unit-' || ${equipmentItems.id}::text,
          ${equipmentReminders.id}::text || ':reminder'
        from ${equipmentReminders}
        join ${equipmentItems} on ${equipmentItems.id} = ${equipmentReminders.equipmentItemId}
          and ${equipmentItems.tenantId} = ${equipmentReminders.tenantId}
        left join ${people} on ${people.id} = ${equipmentReminders.assignedToPersonId}
        where ${equipmentReminders.tenantId} = ${tid} and ${equipmentReminders.completedAt} is null
          and ${equipmentItems.deletedAt} is null and ${equipmentItems.isDraft} = false and ${equipmentItems.status} not in ('retired','lost')
          and (${equipmentScope}) and ${equipmentReminders.dueOn} <= ${horizonIso}::date

        union all
        select 'equipment', 'Periodic maintenance', ${equipmentItems.assetTag} || ' — ' || ${equipmentServicePlans.name},
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), ''),
          ${equipmentItems.currentHolderPersonId}::text,
          (select min((r.value->>'dueOn')::date) from jsonb_array_elements(${equipmentServicePlans.rules}) r(value) where r.value->>'kind'='calendar'),
          case when ${equipmentServiceDueSql(today, true)} then 'overdue' else 'due_soon' end,
          '/equipment/' || ${equipmentItems.id}::text || '?tab=inspections&itab=maintenance', ${equipmentServicePlans.id}::text || ':service'
        from ${equipmentServicePlans}
        join ${equipmentItems} on ${equipmentItems.id}=${equipmentServicePlans.equipmentItemId} and ${equipmentItems.tenantId}=${equipmentServicePlans.tenantId}
        left join ${people} on ${people.id}=${equipmentItems.currentHolderPersonId}
        where ${equipmentServicePlans.tenantId}=${tid} and ${equipmentItems.deletedAt} is null and ${equipmentItems.isDraft}=false
          and ${equipmentItems.status} not in ('retired','lost') and (${equipmentScope}) and ${equipmentServiceDueSql(horizonIso)}

        union all
        select 'equipment', 'Warranty', ${equipmentItems.name} || ' (' || ${equipmentItems.assetTag} || ')',
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), ''),
          ${equipmentItems.currentHolderPersonId}::text, ${equipmentItems.warrantyExpiresOn}::date,
          case when ${equipmentItems.warrantyExpiresOn} < ${today}::date then 'expired' else 'due_soon' end,
          '/equipment/' || ${equipmentItems.id}::text, ${equipmentItems.id}::text || ':warranty'
        from ${equipmentItems}
        left join ${people} on ${people.id} = ${equipmentItems.currentHolderPersonId}
        where ${equipmentItems.tenantId} = ${tid} and ${equipmentItems.deletedAt} is null
          and ${equipmentItems.isDraft} = false and ${equipmentItems.status} not in ('retired','lost') and (${equipmentScope})
          and ${equipmentItems.warrantyExpiresOn} is not null and ${equipmentItems.warrantyExpiresOn} <= ${horizonIso}::date


        union all
        select 'equipment', 'Work order', ${equipmentWorkOrders.reference} ||
          case when ${equipmentItems.name} is not null then ' — ' || ${equipmentItems.name} else '' end,
          null, null, null::date, 'open',
          '/equipment/work-orders/' || ${equipmentWorkOrders.id}::text,
          ${equipmentWorkOrders.id}::text
        from ${equipmentWorkOrders}
        left join ${equipmentItems} on ${equipmentItems.id} = ${equipmentWorkOrders.itemId}
        where ${equipmentWorkOrders.tenantId} = ${tid} and (${equipmentScope})
          and ${equipmentWorkOrders.deletedAt} is null and ${equipmentItems.deletedAt} is null
          and ${equipmentWorkOrders.status} in ('open','assigned','in_progress','awaiting_parts')

        union all
        select 'skills', 'Skill ticket expiry', certification_name,
          person_name, person_id::text, expires_on::date,
          case when outcome = 'expired' or expires_on < ${today}::date then 'expired' else 'due_soon' end,
          '/training/skills/' || id::text, id::text
        from report_skill_assignments
        where tenant_id = ${tid} and person_status = 'active'
          and outcome in ('complete', 'expired') and expires_on is not null
          and expires_on <= ${horizonIso}::date
      ), filtered as (
        select * from signals ${filteredWhere}
      ), totals as (
        select count(*) filter (where status = 'overdue')::bigint as overdue_count,
          count(*) filter (where status = 'expired')::bigint as expired_count,
          count(*) filter (where status = 'due_soon')::bigint as due_soon_count,
          count(*) filter (where status = 'open')::bigint as open_count
        from signals
      ), filtered_total as (
        select count(*)::bigint as total from filtered
      )
      select page_rows.stable_key, page_rows.module, page_rows.family, page_rows.subject, page_rows.person_name,
        page_rows.person_id, page_rows.due_on, page_rows.status, page_rows.href,
        filtered_total.total, totals.overdue_count, totals.expired_count,
        totals.due_soon_count, totals.open_count
      from totals cross join filtered_total
      left join lateral (
        select * from filtered order by ${orderBy} limit ${perPage} offset ${offset}
      ) page_rows on true
      order by ${orderBy}
    `)
    const resultRows = (
      Array.isArray(queryResult)
        ? queryResult
        : (queryResult as unknown as { rows: SignalQueryRow[] }).rows
    ) as SignalQueryRow[]
    const first = resultRows[0]
    return {
      rows: resultRows
        .filter((row) => row.module !== null && row.status !== null)
        .map((row) => ({
          key: row.module! + ':' + row.stable_key,
          module: row.module!,
          family: row.family ?? '',
          subject: row.subject ?? '',
          personName: row.person_name,
          personId: row.person_id,
          dueOn: isoDate(row.due_on),
          status: row.status!,
          href: row.href,
        })),
      total: Number(first?.total ?? 0),
      counts: {
        overdue: Number(first?.overdue_count ?? 0),
        expired: Number(first?.expired_count ?? 0),
        due_soon: Number(first?.due_soon_count ?? 0),
        open: Number(first?.open_count ?? 0),
      },
    }
  })
}
