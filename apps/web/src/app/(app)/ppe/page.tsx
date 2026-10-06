import { PPE_ACTIVE_STATUSES, ppeRegisterQuery } from '@/lib/ppe-register-query'
import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { PeopleStatusFilter } from '@/components/people-status-filter'
import { includeInactivePeople } from '@/lib/people-filter'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { HardHat } from 'lucide-react'
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { people, ppeItems, ppeTypeInspectionCriteria, ppeTypes } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, pickString } from '@/lib/list-params'
import { resolvePpeInspectionDue } from '@/lib/ppe-inspection-due'
import { DownloadLink } from '@/components/download-link'
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
  const {
    params,
    statusFilter,
    holderFilter,
    todayIso,
    where: whereClause,
    assignedAtSql,
    orderBy,
  } = ppeRegisterQuery(sp)
  const ctx = await requireRequestContext()
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'ppe.read.all')
  const canIssue = can(ctx, 'ppe.issue') || can(ctx, 'ppe.manage')

  const { rows, total, statusCounts, types, selectedHolder } = await ctx.db(async (tx) => {
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
        canRecordPreUse:
          can(ctx, 'ppe.inspect') &&
          type.isInspectable &&
          Number(preUseCriteriaCount) > 0 &&
          !['out_of_service', 'discarded', 'expired'].includes(item.status),
        inspectionState: inspection.state,
        inspectionDueOn: inspection.dueOn,
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
                      <DownloadLink href={buildExportHref('/ppe/export.csv', sp)}>
                        <Button variant="outline">
                          <GeneratedText id="m_14c6440eca1edc" />
                        </Button>
                      </DownloadLink>
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
                    ? PPE_ACTIVE_STATUSES.reduce((sum, s) => sum + (statusCounts[s] ?? 0), 0)
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
            <PeopleStatusFilter basePath="/ppe" currentParams={sp} personParamKey="holder" />
            <RemoteSearchFilter
              lookup="ppe-register-filter-holders"
              includeInactive={includeInactivePeople(sp)}
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
