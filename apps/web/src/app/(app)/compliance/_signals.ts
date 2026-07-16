// Cross-module "due & expiring" signals — Milestone 1.5.
//
// The unified hub's CREATE form only handles audience-on-cadence assignments
// (the 5 kinds). But compliance across the platform is mostly a DIFFERENT shape:
// per-record expiries (certs, permits, equipment/PPE due dates), recurring
// per-record check-ins (lone worker), document review cadence, and single-owner
// tasks (corrective actions, work orders, incident preventative steps).
//
// This aggregator READS those signals from each module's own tables and projects
// them into one row shape so the hub can show "everything that needs attention
// across the whole platform" in one place. It is the read-path preview of the
// M3 per-record/expiry completion adapters — when those land, this becomes a
// single query over `compliance_status`.

import { sql, type SQL } from 'drizzle-orm'
import {
  correctiveActions,
  documents,
  equipmentInspectionSchedules,
  equipmentItems,
  equipmentWorkOrders,
  incidentPreventativeSteps,
  formResponses,
  people,
  ppeItems,
  ppeTypes,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export type SignalStatus = 'overdue' | 'expired' | 'due_soon' | 'open'

export type SignalModule =
  | 'training'
  | 'monitored_session'
  | 'documents'
  | 'equipment'
  | 'ppe'
  | 'corrective_actions'
  | 'incidents'

export const SIGNAL_MODULE_LABELS: Record<SignalModule, string> = {
  training: 'Training',
  monitored_session: 'Monitored sessions',
  documents: 'Documents',
  equipment: 'Equipment',
  ppe: 'PPE',
  corrective_actions: 'Corrective actions',
  incidents: 'Incidents',
}

export type ComplianceSignal = {
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
  sort?: 'module' | 'item' | 'person' | 'due' | 'status'
  dir?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

type DueSignalListResult = {
  rows: ComplianceSignal[]
  total: number
  counts: Record<SignalStatus, number>
}

type SignalQueryRow = {
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
 * Every due / expiring / overdue / open-task compliance signal across modules,
 * within the horizon (or already past).
 */
export async function listDueSignals(
  ctx: RequestContext,
  options: DueSignalListOptions = {},
): Promise<DueSignalListResult> {
  const tid = ctx.tenantId!
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const horizonDate = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000)
  const horizonIso = horizonDate.toISOString().slice(0, 10)
  const page = Math.max(1, Math.min(10_000, Math.trunc(options.page ?? 1)))
  const perPage = Math.max(5, Math.min(100, Math.trunc(options.perPage ?? 50)))
  const offset = (page - 1) * perPage
  const filteredConditions: SQL<unknown>[] = []
  if (options.module) filteredConditions.push(sql`module = ${options.module}`)
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
    const queryResult = await tx.execute<SignalQueryRow>(sql`
      with signals as (
        select 'training'::text as module, 'Certification expiry'::text as family,
          coalesce(${trainingCourses.name}, 'Certification')::text as subject,
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), '')::text as person_name,
          ${trainingRecords.personId}::text as person_id, ${trainingRecords.expiresOn}::date as due_on,
          case when ${trainingRecords.expiresOn} < ${today}::date then 'expired' else 'due_soon' end::text as status,
          '/training'::text as href, ${trainingRecords.id}::text as stable_key
        from ${trainingRecords}
        join ${people} on ${people.id} = ${trainingRecords.personId}
        left join ${trainingCourses} on ${trainingCourses.id} = ${trainingRecords.courseId}
        where ${trainingRecords.tenantId} = ${tid} and ${trainingRecords.deletedAt} is null
          and ${trainingRecords.expiresOn} is not null and ${trainingRecords.expiresOn} <= ${horizonIso}::date
          and ${people.status} = 'active' and ${people.deletedAt} is null
          and (${trainingRecords.courseId} is null or not exists (
            select 1 from ${trainingRecords} tr_newer
            where tr_newer.tenant_id = ${trainingRecords.tenantId}
              and tr_newer.person_id = ${trainingRecords.personId}
              and tr_newer.course_id = ${trainingRecords.courseId}
              and tr_newer.deleted_at is null
              and (tr_newer.completed_on, tr_newer.created_at, tr_newer.id)
                > (${trainingRecords.completedOn}, ${trainingRecords.createdAt}, ${trainingRecords.id})
          ))

        union all
        select 'monitored_session', 'Check-in', 'Monitored session check-in', null, null,
          ${formResponses.nextCheckinDueAt}::date,
          case when ${formResponses.monitorStatus} in ('missed','escalated') or ${formResponses.nextCheckinDueAt}::date < ${today}::date then 'overdue' else 'due_soon' end,
          '/apps/sessions', ${formResponses.id}::text
        from ${formResponses}
        where ${formResponses.tenantId} = ${tid}
          and ${formResponses.monitorStatus} in ('active','missed','escalated')
          and ${formResponses.nextCheckinDueAt} <= ${horizonDate.toISOString()}::timestamptz

        union all
        select 'documents', 'Review due', ${documents.title}, null, null, ${documents.nextReviewOn}::date,
          case when ${documents.nextReviewOn} < ${today}::date then 'overdue' else 'due_soon' end,
          '/documents/' || ${documents.id}::text, ${documents.id}::text
        from ${documents}
        where ${documents.tenantId} = ${tid} and ${documents.deletedAt} is null
          and ${documents.status} in ('draft','published','under_review')
          and ${documents.nextReviewOn} is not null and ${documents.nextReviewOn} <= ${horizonIso}::date

        union all
        select 'equipment', 'Inspection', ${equipmentItems.name} || ' (' || ${equipmentItems.assetTag} || ')',
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), ''),
          ${equipmentItems.currentHolderPersonId}::text, min(${equipmentInspectionSchedules.nextDueOn})::date,
          case when min(${equipmentInspectionSchedules.nextDueOn}) < ${today}::date then 'overdue' else 'due_soon' end,
          '/equipment/' || ${equipmentItems.id}::text, ${equipmentItems.id}::text || ':inspection'
        from ${equipmentItems}
        join ${equipmentInspectionSchedules} on ${equipmentInspectionSchedules.equipmentItemId} = ${equipmentItems.id}
          and ${equipmentInspectionSchedules.tenantId} = ${equipmentItems.tenantId}
          and ${equipmentInspectionSchedules.isActive} = true
        left join ${people} on ${people.id} = ${equipmentItems.currentHolderPersonId}
        where ${equipmentItems.tenantId} = ${tid} and ${equipmentItems.deletedAt} is null
          and ${equipmentItems.status} not in ('retired','lost')
        group by ${equipmentItems.id}, ${people.lastName}, ${people.firstName}
        having min(${equipmentInspectionSchedules.nextDueOn}) <= ${horizonIso}::date

        union all
        select 'equipment', 'Oil change', ${equipmentItems.name} || ' (' || ${equipmentItems.assetTag} || ')',
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), ''),
          ${equipmentItems.currentHolderPersonId}::text, ${equipmentItems.nextOilChangeDue}::date,
          case when ${equipmentItems.nextOilChangeDue} < ${today}::date then 'overdue' else 'due_soon' end,
          '/equipment/' || ${equipmentItems.id}::text, ${equipmentItems.id}::text || ':oil'
        from ${equipmentItems}
        left join ${people} on ${people.id} = ${equipmentItems.currentHolderPersonId}
        where ${equipmentItems.tenantId} = ${tid} and ${equipmentItems.deletedAt} is null
          and ${equipmentItems.status} not in ('retired','lost')
          and ${equipmentItems.nextOilChangeDue} is not null and ${equipmentItems.nextOilChangeDue} <= ${horizonIso}::date

        union all
        select 'equipment', 'Warranty', ${equipmentItems.name} || ' (' || ${equipmentItems.assetTag} || ')',
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), ''),
          ${equipmentItems.currentHolderPersonId}::text, ${equipmentItems.warrantyExpiresOn}::date,
          case when ${equipmentItems.warrantyExpiresOn} < ${today}::date then 'expired' else 'due_soon' end,
          '/equipment/' || ${equipmentItems.id}::text, ${equipmentItems.id}::text || ':warranty'
        from ${equipmentItems}
        left join ${people} on ${people.id} = ${equipmentItems.currentHolderPersonId}
        where ${equipmentItems.tenantId} = ${tid} and ${equipmentItems.deletedAt} is null
          and ${equipmentItems.status} not in ('retired','lost')
          and ${equipmentItems.warrantyExpiresOn} is not null and ${equipmentItems.warrantyExpiresOn} <= ${horizonIso}::date

        union all
        select 'ppe', family, coalesce(${ppeTypes.name}, 'PPE') || case when ${ppeItems.serialNumber} is not null then ' · ' || ${ppeItems.serialNumber} else '' end,
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), ''),
          ${ppeItems.currentHolderPersonId}::text, due_on,
          case when expiry and due_on < ${today}::date then 'expired' when due_on < ${today}::date then 'overdue' else 'due_soon' end,
          '/ppe', ${ppeItems.id}::text || ':' || family
        from ${ppeItems}
        left join ${ppeTypes} on ${ppeTypes.id} = ${ppeItems.typeId}
        left join ${people} on ${people.id} = ${ppeItems.currentHolderPersonId}
        cross join lateral (values
          ('Inspection'::text, ${ppeItems.nextInspectionDue}::date, false),
          ('Annual inspection'::text, ${ppeItems.nextAnnualInspectionDue}::date, false),
          ('Expiry'::text, ${ppeItems.expiresOn}::date, true)
        ) signal(family, due_on, expiry)
        where ${ppeItems.tenantId} = ${tid} and ${ppeItems.deletedAt} is null
          and ${ppeItems.status} not in ('discarded','expired')
          and due_on is not null and due_on <= ${horizonIso}::date

        union all
        select 'corrective_actions', 'Corrective action', ${correctiveActions.reference} || ' — ' || ${correctiveActions.title},
          null, null, ${correctiveActions.dueOn}::date,
          case when ${correctiveActions.dueOn} < ${today}::date then 'overdue' else 'due_soon' end,
          '/corrective-actions/' || ${correctiveActions.id}::text, ${correctiveActions.id}::text
        from ${correctiveActions}
        where ${correctiveActions.tenantId} = ${tid} and ${correctiveActions.deletedAt} is null
          and ${correctiveActions.status} in ('open','in_progress','pending_verification')
          and ${correctiveActions.dueOn} is not null and ${correctiveActions.dueOn} <= ${horizonIso}::date

        union all
        select 'incidents', 'Preventative action', 'Preventative action',
          nullif(trim(concat_ws(', ', ${people.lastName}, ${people.firstName})), ''),
          ${incidentPreventativeSteps.ownerPersonId}::text, ${incidentPreventativeSteps.targetDate}::date,
          case when ${incidentPreventativeSteps.targetDate} < ${today}::date then 'overdue' else 'due_soon' end,
          '/incidents/' || ${incidentPreventativeSteps.incidentId}::text, ${incidentPreventativeSteps.id}::text
        from ${incidentPreventativeSteps}
        left join ${people} on ${people.id} = ${incidentPreventativeSteps.ownerPersonId}
        where ${incidentPreventativeSteps.tenantId} = ${tid}
          and ${incidentPreventativeSteps.status} in ('planned','in_progress')
          and ${incidentPreventativeSteps.targetDate} is not null
          and ${incidentPreventativeSteps.targetDate} <= ${horizonIso}::date

        union all
        select 'equipment', 'Work order', ${equipmentWorkOrders.reference} ||
          case when ${equipmentItems.name} is not null then ' — ' || ${equipmentItems.name} else '' end,
          null, null, null::date, 'open',
          case when ${equipmentWorkOrders.itemId} is not null then '/equipment/' || ${equipmentWorkOrders.itemId}::text else '/equipment' end,
          ${equipmentWorkOrders.id}::text
        from ${equipmentWorkOrders}
        left join ${equipmentItems} on ${equipmentItems.id} = ${equipmentWorkOrders.itemId}
        where ${equipmentWorkOrders.tenantId} = ${tid}
          and ${equipmentWorkOrders.status} in ('open','assigned','in_progress','awaiting_parts')
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
      select page_rows.module, page_rows.family, page_rows.subject, page_rows.person_name,
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
