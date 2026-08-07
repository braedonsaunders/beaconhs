import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { HardHat } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
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
import { RemoteSearchFilter } from '@/components/remote-search-select'
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
  'status_changed',
  'updated',
] as const

const STATUS_OPTIONS = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'issued', label: 'Issued' },
  { value: 'returned', label: 'Returned' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'discarded', label: 'Discarded' },
  { value: 'expired', label: 'Expired' },
]

/**
 * The register defaults to gear that is still in circulation. Discarded and
 * expired items stay one chip away rather than being the silent majority of
 * every search — the old default was `issued` alone, which hid returned stock
 * too and made a discarded item look deleted.
 */
const ACTIVE_STATUSES = ['in_stock', 'issued', 'returned', 'out_of_service'] as const
const STATUS_FILTER_OPTIONS = [{ value: 'active', label: 'Active' }, ...STATUS_OPTIONS]

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
  const statusFilter = STATUS_FILTER_OPTIONS.some((o) => o.value === statusRaw)
    ? statusRaw
    : undefined
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

  const { rows, total, statusCounts, types, selectedHolder } = await ctx.db(async (tx) => {
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
    if (statusFilter === 'active') {
      filters.push(inArray(ppeItems.status, [...ACTIVE_STATUSES]))
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
            where pi.item_id = ${ppeItems.id} and pi.person_id = ${holderFilter}
          )`,
        )!,
      )
    }

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
    // Only the selected holder needs resolving — the picker searches remotely,
    // so the page no longer materializes every holder just to build a dropdown.
    const [selected] = holderFilter
      ? await tx
          .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
          .from(people)
          .where(eq(people.id, holderFilter))
          .limit(1)
      : []
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      types: typeRows,
      selectedHolder: selected
        ? { value: selected.id, label: `${selected.lastName}, ${selected.firstName}` }
        : undefined,
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
        statusChangedOn: item.statusChangedAt
          ? new Date(item.statusChangedAt).toISOString().slice(0, 10)
          : null,
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
              defaultValue="active"
              options={STATUS_FILTER_OPTIONS.map((o) => ({
                ...o,
                count:
                  o.value === 'active'
                    ? ACTIVE_STATUSES.reduce((sum, s) => sum + (statusCounts[s] ?? 0), 0)
                    : statusCounts[o.value],
              }))}
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
            <RemoteSearchFilter
              lookup="ppe-register-filter-holders"
              basePath="/ppe"
              currentParams={sp}
              paramKey="holder"
              placeholder={tGenerated('m_1dd437d2b4ab7f')}
              allLabel="All holders"
              searchPlaceholder={tGenerated('m_0ba815306341be')}
              initialOption={selectedHolder}
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
