import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { HardHat } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import {
  people,
  ppeIssues,
  ppeItems,
  ppeTypeInspectionCriteria,
  ppeTypes,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, isUuid, parseListParams, pickString } from '@/lib/list-params'
import { resolvePpeInspectionDue } from '@/lib/ppe-inspection-due'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { PpeSubNav } from '@/components/ppe-sub-nav'
import { createAndIssuePpe } from './_actions'
import { PpeDrawers } from './_drawers'
import { PpeRecordsTable, type PpeTableRow } from './_records-table'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_18391e161b9ed6') }
}

const SORTS = [
  'type',
  'serial',
  'size',
  'status',
  'holder',
  'assigned',
  'last_inspection',
  'next_inspection',
] as const

const STATUS_OPTIONS = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'issued', label: 'Issued' },
  { value: 'returned', label: 'Returned' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'discarded', label: 'Discarded' },
  { value: 'expired', label: 'Expired' },
]

const INSPECTION_OPTIONS = [
  { value: 'needs_inspection', label: 'Needs inspection' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'current', label: 'Current' },
  { value: 'not_required', label: 'Not required' },
] as const

export default async function PpePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'next_inspection',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Default the register to issued items; an explicit `status=all` (the "All
  // statuses" chip) clears the default so every status shows. Unknown values
  // would throw a Postgres enum error, so they're whitelisted to "no filter".
  const statusRaw = pickString(sp.status) ?? 'issued'
  const statusFilter = STATUS_OPTIONS.some((o) => o.value === statusRaw) ? statusRaw : undefined
  const inspectionRaw = pickString(sp.inspection)
  const inspectionFilter = INSPECTION_OPTIONS.some((option) => option.value === inspectionRaw)
    ? inspectionRaw
    : undefined
  const typeRaw = pickString(sp.type)
  const typeFilter = typeRaw && isUuid(typeRaw) ? typeRaw : undefined
  const holderRaw = pickString(sp.holder)
  const holderFilter = holderRaw && isUuid(holderRaw) ? holderRaw : undefined
  const ctx = await requireRequestContext()
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'ppe.read.all')
  const canIssue = can(ctx, 'ppe.issue') || can(ctx, 'ppe.manage')

  const todayIso = new Date().toISOString().slice(0, 10)
  const dueSoonDate = new Date(`${todayIso}T00:00:00.000Z`)
  dueSoonDate.setUTCDate(dueSoonDate.getUTCDate() + 7)
  const dueSoonIso = dueSoonDate.toISOString().slice(0, 10)

  const { rows, total, statusCounts, types, holders } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(ppeItems.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(ppeItems.serialNumber, term),
        ilike(ppeTypes.name, term),
        ilike(people.firstName, term),
        ilike(people.lastName, term),
        ilike(sql<string>`concat_ws(' ', ${people.firstName}, ${people.lastName})`, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) {
      filters.push(
        eq(
          ppeItems.status,
          statusFilter as 'in_stock' | 'issued' | 'returned' | 'out_of_service' | 'discarded' | 'expired',
        ),
      )
    }
    if (typeFilter) filters.push(eq(ppeItems.typeId, typeFilter))
    if (holderFilter) filters.push(eq(ppeItems.currentHolderPersonId, holderFilter))

    const preUseCriteriaExists = sql<boolean>`exists (
      select 1 from ${ppeTypeInspectionCriteria} c
      where c.ppe_type_id = ${ppeTypes.id} and c.inspection_kind = 'pre_use'
    )`
    const annualCriteriaExists = sql<boolean>`exists (
      select 1 from ${ppeTypeInspectionCriteria} c
      where c.ppe_type_id = ${ppeTypes.id} and c.inspection_kind = 'annual'
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
                    : [dirFn(ppeTypes.name)]

    const [tot] = await tx
      .select({ c: count() })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(whereClause)
    const data = await tx
      .select({
        item: ppeItems,
        type: ppeTypes,
        holder: people,
        assignedAt: assignedAtSql,
        preUseCriteriaCount: sql<number>`(
          select count(*)::int from ${ppeTypeInspectionCriteria} c
          where c.ppe_type_id = ${ppeTypes.id} and c.inspection_kind = 'pre_use'
        )`,
        annualCriteriaCount: sql<number>`(
          select count(*)::int from ${ppeTypeInspectionCriteria} c
          where c.ppe_type_id = ${ppeTypes.id} and c.inspection_kind = 'annual'
        )`,
      })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const ss = await tx
      .select({ s: ppeItems.status, c: count() })
      .from(ppeItems)
      .where(isNull(ppeItems.deletedAt))
      .groupBy(ppeItems.status)
    const typeRows = await tx
      .select({
        id: ppeTypes.id,
        name: ppeTypes.name,
        category: ppeTypes.category,
        sizingScheme: ppeTypes.sizingScheme,
      })
      .from(ppeTypes)
      .orderBy(asc(ppeTypes.name))
    const holderRows = await tx
      .selectDistinct({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(ppeItems)
      .innerJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(and(isNull(ppeItems.deletedAt), eq(ppeItems.status, 'issued')))
      .orderBy(asc(people.lastName), asc(people.firstName))
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      types: typeRows,
      holders: holderRows,
    }
  })

  const issueDrawer = pickString(sp.drawer) === 'issue' ? 'issue' : null

  const tableRows: PpeTableRow[] = rows.map(
    ({ item, type, holder, assignedAt, preUseCriteriaCount, annualCriteriaCount }) => {
      const inspection = resolvePpeInspectionDue({
        todayIso,
        isInspectable: type.isInspectable,
        preUseCriteriaCount: Number(preUseCriteriaCount),
        annualCriteriaCount: Number(annualCriteriaCount),
        lastInspectionOn: item.lastInspectionOn,
        nextInspectionDue: item.nextInspectionDue,
        lastAnnualInspectionOn: item.lastAnnualInspectionOn,
        nextAnnualInspectionDue: item.nextAnnualInspectionDue,
      })
      return {
        id: item.id,
        typeName: type.name,
        serialNumber: item.serialNumber,
        size: item.size,
        status: item.status,
        holderName: holder ? `${holder.firstName} ${holder.lastName}` : null,
        assignedOn: assignedAt ? new Date(assignedAt).toISOString().slice(0, 10) : null,
        lastInspectionOn:
          inspection.kind === 'annual' ? item.lastAnnualInspectionOn : item.lastInspectionOn,
        inspectionKind: inspection.kind,
        inspectionState: inspection.state,
        inspectionDueOn: inspection.dueOn,
        inspectionActionable: inspection.actionable,
      }
    },
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_18391e161b9ed6')}
            description={tGenerated('m_1b88ed46c964ad')}
            actions={
              <div className="flex items-center gap-2">
                <GeneratedValue
                  value={
                    canExport ? (
                      <a href={buildExportHref('/ppe/export.csv', sp)}>
                        <Button variant="outline">
                          <GeneratedText id="m_14c6440eca1edc" />
                        </Button>
                      </a>
                    ) : null
                  }
                />
                <Link href="/ppe?drawer=issue" scroll={false}>
                  <Button>
                    <GeneratedText id="m_14d0f6a29a2597" />
                  </Button>
                </Link>
              </div>
            }
          />
          <PpeSubNav active="records" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_11cff7d8946766')} />
            <FilterChips
              basePath="/ppe"
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              allLabel="All statuses"
              defaultValue="issued"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/ppe"
              currentParams={sp}
              paramKey="inspection"
              label={tGenerated('m_0ef24e5f31b073')}
              allLabel="All inspection states"
              options={INSPECTION_OPTIONS.map((option) => option)}
            />
            <FilterChips
              basePath="/ppe"
              currentParams={sp}
              paramKey="type"
              label={tGenerated('m_0bdc13fe741bfd')}
              allLabel="All PPE types"
              options={types.map((type) => ({ value: type.id, label: type.name }))}
            />
            <FilterChips
              basePath="/ppe"
              currentParams={sp}
              paramKey="holder"
              label={tGenerated('m_1dd437d2b4ab7f')}
              allLabel="All holders"
              options={holders.map((holder) => ({
                value: holder.id,
                label: `${holder.lastName}, ${holder.firstName}`,
              }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<HardHat size={32} />}
              title={tGeneratedValue(
                params.q || statusFilter
                  ? tGenerated('m_0248860124a3b8')
                  : tGenerated('m_1377ea870e44b9'),
              )}
              description={tGenerated('m_14072059043556')}
              action={
                <Link href="/ppe?drawer=issue" scroll={false}>
                  <Button>
                    <GeneratedText id="m_14d0f6a29a2597" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <>
              <PpeRecordsTable
                rows={tableRows}
                basePath="/ppe"
                currentParams={sp}
                sort={params.sort}
                dir={params.dir}
              />
              <Pagination
                basePath="/ppe"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
      <PpeDrawers
        openDrawer={issueDrawer}
        closeHref="/ppe"
        types={types}
        issueAction={createAndIssuePpe}
      />
    </ListPageLayout>
  )
}
