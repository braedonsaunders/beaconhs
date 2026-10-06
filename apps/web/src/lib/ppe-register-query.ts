import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  people,
  ppeIssues,
  ppeItems,
  ppeItemStatus,
  ppeTypes,
  ppeTypeInspectionCriteria,
} from '@beaconhs/db/schema'
import { isUuid, parseListParams, pickString } from './list-params'
import { recordSearchWhere } from './record-search'

const SORTS = [
  'type',
  'serial',
  'size',
  'status',
  'holder',
  'assigned',
  'last_inspection',
  'next_inspection',
  'status_changed',
  'updated',
] as const

export const PPE_ACTIVE_STATUSES = ['in_stock', 'issued', 'returned', 'out_of_service'] as const
const INSPECTION_FILTERS = [
  'needs_inspection',
  'overdue',
  'due_soon',
  'current',
  'not_required',
] as const

/** The PPE register and CSV share their complete search, filters, and stable ordering. */
export function ppeRegisterQuery(
  sp: Record<string, string | string[] | undefined>,
  todayIso = new Date().toISOString().slice(0, 10),
) {
  const params = parseListParams(sp, {
    // Most-recently-moved first: the register is read as a worklist, and a
    // due-date sort buried anything that just changed hands.
    sort: 'status_changed',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Default to in-circulation gear; `status=active` is that default made
  // explicit, and `status=all` clears it. Unknown values would throw a
  // Postgres enum error, so they're whitelisted to "no filter".
  const statusRaw = pickString(sp.status) ?? 'active'
  const statusFilter =
    statusRaw === 'active' || ppeItemStatus.enumValues.some((value) => value === statusRaw)
      ? statusRaw
      : undefined
  const inspectionRaw = pickString(sp.inspection)
  const inspectionFilter = INSPECTION_FILTERS.some((value) => value === inspectionRaw)
    ? inspectionRaw
    : undefined
  const typeRaw = pickString(sp.type)
  const typeFilter = typeRaw && isUuid(typeRaw) ? typeRaw : undefined
  const holderRaw = pickString(sp.holder)
  const holderFilter = holderRaw && isUuid(holderRaw) ? holderRaw : undefined

  const dueSoonDate = new Date(`${todayIso}T00:00:00.000Z`)
  dueSoonDate.setUTCDate(dueSoonDate.getUTCDate() + 7)
  const dueSoonIso = dueSoonDate.toISOString().slice(0, 10)
  const filters: SQL<unknown>[] = [isNull(ppeItems.deletedAt)]
  const search = recordSearchWhere('ppe', params.q)
  if (search) filters.push(search)
  if (statusFilter === 'active') {
    filters.push(inArray(ppeItems.status, [...PPE_ACTIVE_STATUSES]))
  } else if (statusFilter) {
    filters.push(
      eq(
        ppeItems.status,
        statusFilter as
          'in_stock' | 'issued' | 'returned' | 'out_of_service' | 'discarded' | 'expired',
      ),
    )
  }
  if (typeFilter) filters.push(eq(ppeItems.typeId, typeFilter))
  if (holderFilter) {
    // Match the CURRENT holder or anyone the item was ever issued to.
    // Discarding and returning both null the holder column, so a
    // current-holder-only match made returned and discarded gear
    // unfindable by the person who actually had it.
    filters.push(
      or(
        eq(ppeItems.currentHolderPersonId, holderFilter),
        sql`exists (
          select 1 from ${ppeIssues} pi
          where pi.item_id = ${ppeItems.id} and pi.tenant_id = ${ppeItems.tenantId}
            and pi.person_id = ${holderFilter}
        )`,
      )!,
    )
  }

  const preUseCriteriaExists = sql<boolean>`exists (
    select 1 from ${ppeTypeInspectionCriteria} c
    where c.ppe_type_id = ${ppeTypes.id} and c.tenant_id = ${ppeItems.tenantId} and c.inspection_kind = 'pre_use'
  )`
  const annualCriteriaExists = sql<boolean>`exists (
    select 1 from ${ppeTypeInspectionCriteria} c
    where c.ppe_type_id = ${ppeTypes.id} and c.tenant_id = ${ppeItems.tenantId} and c.inspection_kind = 'annual'
  )`
  const inspectionRequired = sql<boolean>`(
    ${ppeTypes.isInspectable} = true and (${preUseCriteriaExists} or ${annualCriteriaExists})
  )`
  const inspectionActionable = sql<boolean>`(
    ${inspectionRequired} and (
      (${preUseCriteriaExists} and (${ppeItems.nextInspectionDue} is null or ${ppeItems.nextInspectionDue} <= ${todayIso}))
      or (${annualCriteriaExists} and (${ppeItems.nextAnnualInspectionDue} is null or ${ppeItems.nextAnnualInspectionDue} <= ${todayIso}))
    )
  )`
  if (inspectionFilter === 'needs_inspection') filters.push(inspectionActionable)
  if (inspectionFilter === 'overdue') {
    filters.push(sql`(${inspectionRequired} and (
      (${preUseCriteriaExists} and ${ppeItems.nextInspectionDue} < ${todayIso})
      or (${annualCriteriaExists} and ${ppeItems.nextAnnualInspectionDue} < ${todayIso})
    ))`)
  }
  if (inspectionFilter === 'due_soon') {
    filters.push(sql`(${inspectionRequired} and not ${inspectionActionable} and (
      (${preUseCriteriaExists} and ${ppeItems.nextInspectionDue} <= ${dueSoonIso})
      or (${annualCriteriaExists} and ${ppeItems.nextAnnualInspectionDue} <= ${dueSoonIso})
    ))`)
  }
  if (inspectionFilter === 'current') {
    filters.push(sql`(${inspectionRequired} and not ${inspectionActionable} and
      least(
        coalesce(${ppeItems.nextInspectionDue}, '9999-12-31'::date),
        coalesce(${ppeItems.nextAnnualInspectionDue}, '9999-12-31'::date)
      ) > ${dueSoonIso})`)
  }
  if (inspectionFilter === 'not_required') filters.push(sql`not ${inspectionRequired}`)
  const whereClause = and(...filters)

  // "Date assigned" = the most recent issue/replace event for the item (when
  // its current holder received it). Correlated subquery so we can both sort
  // and display it; there is no assigned-date column on ppe_items.
  const assignedAtSql = sql<string | null>`(
    select max(${ppeIssues.occurredAt})
    from ${ppeIssues}
    where ${ppeIssues.itemId} = ${ppeItems.id}
      and ${ppeIssues.tenantId} = ${ppeItems.tenantId}
      and ${ppeIssues.action} in ('issue', 'replace')
  )`

  const dirFn = params.dir === 'asc' ? asc : desc
  const orderBy =
    params.sort === 'serial'
      ? [dirFn(ppeItems.serialNumber)]
      : params.sort === 'size'
        ? [dirFn(ppeItems.size)]
        : params.sort === 'status'
          ? [dirFn(ppeItems.status)]
          : params.sort === 'holder'
            ? [dirFn(people.lastName)]
            : params.sort === 'assigned'
              ? // Never-assigned items sink to the bottom in both directions.
                [
                  params.dir === 'asc'
                    ? sql`${assignedAtSql} asc nulls last`
                    : sql`${assignedAtSql} desc nulls last`,
                ]
              : params.sort === 'last_inspection'
                ? // Never-inspected items sink to the bottom in both directions.
                  [
                    params.dir === 'asc'
                      ? sql`${ppeItems.lastInspectionOn} asc nulls last`
                      : sql`${ppeItems.lastInspectionOn} desc nulls last`,
                  ]
                : params.sort === 'next_inspection'
                  ? [
                      sql`case when ${inspectionActionable} then 0 else 1 end asc`,
                      sql`least(
                        coalesce(${ppeItems.nextInspectionDue}, '9999-12-31'::date),
                        coalesce(${ppeItems.nextAnnualInspectionDue}, '9999-12-31'::date)
                      ) ${params.dir === 'asc' ? sql`asc` : sql`desc`}`,
                    ]
                  : params.sort === 'status_changed'
                    ? // Items whose status never moved sink to the bottom.
                      [
                        params.dir === 'asc'
                          ? sql`${ppeItems.statusChangedAt} asc nulls last`
                          : sql`${ppeItems.statusChangedAt} desc nulls last`,
                      ]
                    : params.sort === 'updated'
                      ? [dirFn(ppeItems.updatedAt)]
                      : [dirFn(ppeTypes.name)]

  return {
    params,
    statusRaw,
    statusFilter,
    inspectionFilter,
    typeFilter,
    holderFilter,
    todayIso,
    where: whereClause,
    assignedAtSql,
    orderBy: [...orderBy, asc(ppeItems.id)],
  }
}
