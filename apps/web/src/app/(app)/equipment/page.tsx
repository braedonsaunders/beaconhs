import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Wrench } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import {
  equipmentCategories,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { EquipmentRecordsTable, type EquipmentTableRow } from './_records-table'
import { EquipmentTypeCategoryFilters } from './_filters'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_17f17df74f7e69') }
}

const SORTS = [
  'asset_tag',
  'name',
  'category',
  'type',
  'status',
  'site',
  'holder',
  'purchase_date',
] as const

const STATUS_OPTIONS = [
  { value: 'in_service', label: 'In service' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'lost', label: 'Lost' },
  { value: 'retired', label: 'Retired' },
]

const AVAILABILITY_OPTIONS = [
  { value: 'available', label: 'Available for check-out' },
  { value: 'checked_out', label: 'Currently checked out' },
]

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'asset_tag',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Default the register to in-service assets; the "All statuses" chip
  // (status=all) clears the default so every status shows.
  const statusRaw = pickString(sp.status) ?? 'in_service'
  const statusFilter = statusRaw === 'all' ? undefined : statusRaw
  const availabilityFilter = pickString(sp.availability)
  const typeFilter = pickString(sp.type)
  const categoryFilter = pickString(sp.category)
  const ctx = await requireRequestContext()
  const canManageEquipment = can(ctx, 'equipment.manage')
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'equipment.read.site')

  const { rows, total, statusCounts, availabilityCounts, allTypes, allCats } = await ctx.db(
    async (tx) => {
      const allTypes = await tx
        .select({ id: equipmentTypes.id, name: equipmentTypes.name })
        .from(equipmentTypes)
        .where(eq(equipmentTypes.tenantId, ctx.tenantId))
        .orderBy(asc(equipmentTypes.name))
      const allCats = await tx
        .select({ id: equipmentCategories.id, name: equipmentCategories.name })
        .from(equipmentCategories)
        .where(eq(equipmentCategories.tenantId, ctx.tenantId))
        .orderBy(asc(equipmentCategories.sortOrder), asc(equipmentCategories.name))
      // Read-tier scope: equipment.read.all → every asset; read.site → assets at
      // the caller's scoped sites; neither → only assets they currently hold.
      const vis = await moduleScopeWhere(ctx, tx, {
        prefix: 'equipment',
        siteCol: equipmentItems.currentSiteOrgUnitId,
        personCol: equipmentItems.currentHolderPersonId,
      })
      const filters: SQL<unknown>[] = [isNull(equipmentItems.deletedAt)]
      if (vis) filters.push(vis)
      if (params.q) {
        const term = `%${params.q}%`
        const cond = or(
          ilike(equipmentItems.assetTag, term),
          ilike(equipmentItems.name, term),
          ilike(equipmentItems.serialNumber, term),
        )
        if (cond) filters.push(cond)
      }
      if (statusFilter) filters.push(eq(equipmentItems.status, statusFilter as any))
      if (availabilityFilter === 'available') {
        filters.push(eq(equipmentItems.isAvailableForCheckout, true))
      } else if (availabilityFilter === 'checked_out') {
        filters.push(eq(equipmentItems.isAvailableForCheckout, false))
      }
      if (typeFilter) filters.push(eq(equipmentItems.typeId, typeFilter))
      if (categoryFilter) filters.push(eq(equipmentItems.categoryId, categoryFilter))
      const whereClause = and(...filters)

      const dirFn = params.dir === 'asc' ? asc : desc
      const orderBy =
        params.sort === 'name'
          ? [dirFn(equipmentItems.name)]
          : params.sort === 'category'
            ? [dirFn(equipmentCategories.name)]
            : params.sort === 'type'
              ? [dirFn(equipmentTypes.name)]
              : params.sort === 'status'
                ? [dirFn(equipmentItems.status)]
                : params.sort === 'site'
                  ? [dirFn(orgUnits.name)]
                  : params.sort === 'holder'
                    ? [dirFn(people.lastName)]
                    : params.sort === 'purchase_date'
                      ? [dirFn(equipmentItems.purchaseDate)]
                      : [dirFn(equipmentItems.assetTag)]

      const [tot] = await tx.select({ c: count() }).from(equipmentItems).where(whereClause)
      const data = await tx
        .select({
          item: equipmentItems,
          category: equipmentCategories,
          type: equipmentTypes,
          site: orgUnits,
          holder: people,
        })
        .from(equipmentItems)
        .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
        .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
        .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage)
      const ss = await tx
        .select({ s: equipmentItems.status, c: count() })
        .from(equipmentItems)
        .where(and(isNull(equipmentItems.deletedAt), vis))
        .groupBy(equipmentItems.status)
      const av = await tx
        .select({ a: equipmentItems.isAvailableForCheckout, c: count() })
        .from(equipmentItems)
        .where(and(isNull(equipmentItems.deletedAt), vis))
        .groupBy(equipmentItems.isAvailableForCheckout)
      return {
        rows: data,
        total: Number(tot?.c ?? 0),
        statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
        availabilityCounts: {
          available: Number(av.find((x) => x.a === true)?.c ?? 0),
          checked_out: Number(av.find((x) => x.a === false)?.c ?? 0),
        } as Record<string, number>,
        allTypes,
        allCats,
      }
    },
  )

  const typeOptions = allTypes.map((t) => ({ value: t.id, label: t.name }))
  const categoryOptions = allCats.map((c) => ({ value: c.id, label: c.name }))

  const tableRows: EquipmentTableRow[] = rows.map(({ item, category, type, site, holder }) => ({
    id: item.id,
    assetTag: item.assetTag,
    name: item.name,
    categoryName: category?.name ?? null,
    typeName: type?.name ?? null,
    status: item.status,
    siteName: site?.name ?? null,
    holderName: holder ? `${holder.firstName} ${holder.lastName}` : null,
    isMissing: item.isMissing,
    isDraft: item.isDraft,
  }))

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_17f17df74f7e69')}
            description={tGenerated('m_1c3c92bc9defc8')}
            actions={
              <div className="flex items-center gap-2">
                <GeneratedValue
                  value={
                    canExport ? (
                      <a
                        href={buildExportHref('/equipment/export.csv', {
                          ...sp,
                          status: statusRaw,
                        })}
                      >
                        <Button variant="outline">
                          <GeneratedText id="m_14c6440eca1edc" />
                        </Button>
                      </a>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    canManageEquipment ? (
                      <Link href="/equipment/new">
                        <Button>
                          <GeneratedText id="m_105ebaff0d3ac5" />
                        </Button>
                      </Link>
                    ) : null
                  }
                />
              </div>
            }
          />
          <EquipmentSubNav active="equipment" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_17a9e63a53bd0d')} />
            <FilterChips
              basePath="/equipment"
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              allLabel="All statuses"
              defaultValue="in_service"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/equipment"
              currentParams={sp}
              paramKey="availability"
              label={tGenerated('m_0a782f11294c36')}
              options={AVAILABILITY_OPTIONS.map((o) => ({
                ...o,
                count: availabilityCounts[o.value],
              }))}
            />
            <EquipmentTypeCategoryFilters
              basePath="/equipment"
              currentParams={sp}
              types={typeOptions}
              categories={categoryOptions}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Wrench size={32} />}
              title={tGeneratedValue(
                params.q || statusFilter
                  ? tGenerated('m_093bb01f408194')
                  : tGenerated('m_0f44a06d1a2711'),
              )}
              description={tGenerated('m_191ab10c462021')}
              action={
                canManageEquipment ? (
                  <Link href="/equipment/new">
                    <Button>
                      <GeneratedText id="m_105ebaff0d3ac5" />
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <EquipmentRecordsTable
                rows={tableRows}
                basePath="/equipment"
                currentParams={sp}
                sort={params.sort}
                dir={params.dir}
                canManage={canManageEquipment}
                canExport={canExport}
              />
              <Pagination
                basePath="/equipment"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
    </ListPageLayout>
  )
}
