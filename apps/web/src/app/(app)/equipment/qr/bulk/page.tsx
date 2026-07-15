import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Printer } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { RemoteSearchFilter } from '@/components/remote-search-select'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { Section } from '@/components/section'
import { SelectAllCheckbox } from '@/components/select-all-checkbox'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { generateBulkQrSheet } from './_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0b23e127482528') }
}
export const dynamic = 'force-dynamic'
const BASE = '/equipment/qr/bulk'
const SORTS = ['asset_tag', 'name', 'type'] as const

export default async function BulkQrPage({
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
    perPage: 50,
    allowedSorts: SORTS,
  })
  const typeParam = pickString(sp.typeId)
  const ctx = await requireRequestContext()
  // Same gate + scope bounding as the CSV export: the picker lists asset tags,
  // names, and QR tokens.
  assertCan(ctx, 'equipment.read.site')

  const { rows, total } = await ctx.db(async (tx) => {
    const typeFilter = typeParam && isUuid(typeParam) ? typeParam : undefined
    const filters: SQL<unknown>[] = [isNull(equipmentItems.deletedAt)]
    const scope = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    if (scope) filters.push(scope)
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(equipmentItems.assetTag, term), ilike(equipmentItems.name, term))
      if (cond) filters.push(cond)
    }
    if (typeFilter) filters.push(eq(equipmentItems.typeId, typeFilter))
    const where = filters.length ? and(...filters) : undefined
    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'name'
        ? [dirFn(equipmentItems.name), asc(equipmentItems.assetTag)]
        : params.sort === 'type'
          ? [dirFn(equipmentTypes.name), asc(equipmentItems.assetTag)]
          : [dirFn(equipmentItems.assetTag)]
    const [totalRow] = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .where(where)
    const items = await tx
      .select({ item: equipmentItems, type: equipmentTypes })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .where(where)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return { rows: items, total: Number(totalRow?.c ?? 0) }
  })
  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_0b23e127482528')}
            description={tGenerated('m_0f909595638586')}
            back={{ href: '/equipment', label: 'Back to equipment' }}
          />
          <EquipmentSubNav active="equipment" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0ab33e0dd92de5')} />
            <RemoteSearchFilter
              lookup="equipment-types"
              basePath={BASE}
              currentParams={sp}
              paramKey="typeId"
              placeholder={tGenerated('m_074ba2f160c506')}
              allLabel="All types"
              searchPlaceholder={tGenerated('m_129f9c4e0a75c8')}
            />
          </TableToolbar>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <Badge variant="secondary">
              <GeneratedValue value={total} /> <GeneratedText id="m_198ee0c8c44de2" />
            </Badge>
          </div>
        </>
      }
    >
      <Section title={tGenerated('m_1dc8a5f3ade7e5')} defaultOpen>
        <form action={generateBulkQrSheet} className="space-y-4">
          <GeneratedValue
            value={
              rows.length === 0 ? (
                <EmptyState
                  title={tGeneratedValue(
                    params.q || typeParam
                      ? tGenerated('m_126bb11d3cf45c')
                      : tGenerated('m_0f44a06d1a2711'),
                  )}
                  description={tGenerated('m_18b39d94c6c6fa')}
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 text-center">
                          <SelectAllCheckbox
                            itemName="ids"
                            ariaLabel="Select all visible equipment"
                          />
                        </TableHead>
                        <SortableTh
                          {...sortProps}
                          column="asset_tag"
                          active={params.sort === 'asset_tag'}
                        >
                          <GeneratedText id="m_0d9ccb155777db" />
                        </SortableTh>
                        <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                          <GeneratedText id="m_02b18d5c7f6f2d" />
                        </SortableTh>
                        <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                          <GeneratedText id="m_074ba2f160c506" />
                        </SortableTh>
                        <TableHead>
                          <GeneratedText id="m_0d04212bb3d171" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <GeneratedValue
                        value={rows.map(({ item, type }) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-center">
                              <input type="checkbox" name="ids" value={item.id} />
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              <GeneratedValue value={item.assetTag} />
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/equipment/${item.id}`}
                                className="font-medium hover:underline"
                              >
                                <GeneratedValue value={item.name} />
                              </Link>
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400">
                              <GeneratedValue value={type?.name ?? '—'} />
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-500 dark:text-slate-400">
                              <GeneratedValue value={item.qrToken.slice(0, 12)} />…
                            </TableCell>
                          </TableRow>
                        ))}
                      />
                    </TableBody>
                  </Table>
                </div>
              )
            }
          />
          <Pagination
            basePath={BASE}
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-800">
            <div className="text-slate-600 dark:text-slate-400">
              <GeneratedText id="m_1f5715ef89b080" />
            </div>
            <div className="flex items-center gap-2">
              <Link href="/equipment">
                <Button type="button" variant="outline">
                  <GeneratedText id="m_112e2e8ecda428" />
                </Button>
              </Link>
              <Button type="submit">
                <Printer size={14} /> <GeneratedText id="m_0f463343b9f7d7" />
              </Button>
            </div>
          </div>
        </form>
      </Section>
    </ListPageLayout>
  )
}
