import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { PeopleStatusFilter } from '@/components/people-status-filter'
import { includeInactivePeople } from '@/lib/people-filter'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Wrench } from 'lucide-react'
import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import {
  departments,
  equipmentCategories,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { DownloadLink } from '@/components/download-link'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { buildExportHref } from '@/lib/list-params'
import { equipmentRegisterQuery } from '@/lib/equipment/register-query'
import { SearchInput } from '@/components/search-input'
import { RemoteSearchFilter } from '@/components/remote-search-select'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { EquipmentRecordsTable, type EquipmentTableRow } from './_records-table'
import { EquipmentRegisterFilters } from './_filters'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_17f17df74f7e69') }
}

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
  const { params, statusRaw, statusFilter } = equipmentRegisterQuery(sp)
  const ctx = await requireRequestContext()
  if (
    can(ctx, 'equipment.vehicle-log.update.own') &&
    !can(ctx, 'equipment.read.self') &&
    !can(ctx, 'equipment.manage')
  )
    redirect('/equipment/vehicle-log')
  const canManageEquipment = can(ctx, 'equipment.manage')
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'equipment.read.site')

  const { rows, total, statusCounts, availabilityCounts, allTypes, allCats, allDepartments } =
    await ctx.db(async (tx) => {
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
      const allDepartments = await tx
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(eq(departments.tenantId, ctx.tenantId))
        .orderBy(asc(departments.name))
      // Read-tier scope: equipment.read.all → every asset; read.site → assets at
      // the caller's scoped sites; neither → only assets they currently hold.
      const vis = await moduleScopeWhere(ctx, tx, {
        prefix: 'equipment',
        siteCol: equipmentItems.currentSiteOrgUnitId,
        personCol: equipmentItems.currentHolderPersonId,
      })
      const { where: whereClause, orderBy } = equipmentRegisterQuery(sp, vis)

      const [tot] = await tx
        .select({ c: count() })
        .from(equipmentItems)
        .leftJoin(
          departments,
          and(
            eq(departments.tenantId, equipmentItems.tenantId),
            eq(departments.id, equipmentItems.departmentId),
          ),
        )
        .where(whereClause)
      const data = await tx
        .select({
          item: equipmentItems,
          department: departments,
          category: equipmentCategories,
          type: equipmentTypes,
          site: orgUnits,
          holder: people,
        })
        .from(equipmentItems)
        .leftJoin(
          departments,
          and(
            eq(departments.tenantId, equipmentItems.tenantId),
            eq(departments.id, equipmentItems.departmentId),
          ),
        )
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
        allDepartments,
      }
    })

  const typeOptions = allTypes.map((t) => ({ value: t.id, label: t.name }))
  const categoryOptions = allCats.map((c) => ({ value: c.id, label: c.name }))

  const tableRows: EquipmentTableRow[] = rows.map(
    ({ item, category, type, department, site, holder }) => ({
      id: item.id,
      assetTag: item.assetTag,
      name: item.name,
      categoryName: category?.name ?? null,
      typeName: type?.name ?? null,
      departmentName: department?.name ?? null,
      status: item.status,
      siteName: site?.name ?? null,
      holderName: holder ? `${holder.firstName} ${holder.lastName}` : null,
      isMissing: item.isMissing,
      isDraft: item.isDraft,
    }),
  )

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
                      <DownloadLink
                        href={buildExportHref('/equipment/export.csv', {
                          ...sp,
                          status: statusRaw,
                        })}
                      >
                        <Button variant="outline">
                          <GeneratedText id="m_14c6440eca1edc" />
                        </Button>
                      </DownloadLink>
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
            <SearchInput placeholder={tGenerated('m_065ee385b4c0bd')} />
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
            <EquipmentRegisterFilters
              basePath="/equipment"
              currentParams={sp}
              types={typeOptions}
              categories={categoryOptions}
              departments={allDepartments.map((d) => ({ value: d.id, label: d.name }))}
            />
            <PeopleStatusFilter basePath="/equipment" currentParams={sp} personParamKey="holder" />
            <RemoteSearchFilter
              lookup="equipment-register-filter-holders"
              includeInactive={includeInactivePeople(sp)}
              basePath="/equipment"
              currentParams={sp}
              paramKey="holder"
              placeholder={tGeneratedValue('All holders')}
              searchPlaceholder={tGeneratedValue('Search holders…')}
              ariaLabel={tGeneratedValue('Filter by holder')}
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
