import Link from 'next/link'
import { Wrench } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
import { equipmentItems, equipmentTypes, orgUnits, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'Equipment' }

const SORTS = ['asset_tag', 'name', 'status', 'site', 'holder', 'purchase_date'] as const

const STATUS_OPTIONS = [
  { value: 'in_service', label: 'In service' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'lost', label: 'Lost' },
  { value: 'retired', label: 'Retired' },
]

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'asset_tag', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
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
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'name'
        ? [params.dir === 'asc' ? asc(equipmentItems.name) : desc(equipmentItems.name)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(equipmentItems.status) : desc(equipmentItems.status)]
          : params.sort === 'site'
            ? [params.dir === 'asc' ? asc(orgUnits.name) : desc(orgUnits.name)]
            : params.sort === 'holder'
              ? [params.dir === 'asc' ? asc(people.lastName) : desc(people.lastName)]
              : params.sort === 'purchase_date'
                ? [params.dir === 'asc' ? asc(equipmentItems.purchaseDate) : desc(equipmentItems.purchaseDate)]
                : [params.dir === 'asc' ? asc(equipmentItems.assetTag) : desc(equipmentItems.assetTag)]

    const [tot] = await tx.select({ c: count() }).from(equipmentItems).where(whereClause)
    const data = await tx
      .select({ item: equipmentItems, type: equipmentTypes, site: orgUnits, holder: people })
      .from(equipmentItems)
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
      .groupBy(equipmentItems.status)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/equipment', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Equipment"
            description="Asset registry. QR scan + inspections + work orders."
            actions={
              <Link href="/equipment/new">
                <Button>Add equipment</Button>
              </Link>
            }
          />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search asset tag, name, serial #" />
          </div>
          <FilterChips
            basePath="/equipment"
            currentParams={sp}
            paramKey="status"
            label="Status"
            options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Wrench size={32} />}
          title={params.q || statusFilter ? 'No equipment matches these filters' : 'No equipment yet'}
          description="Add your first asset to start tracking inspections, transfers, and work orders."
          action={
            <Link href="/equipment/new">
              <Button>Add your first asset</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="asset_tag" active={params.sort === 'asset_tag'}>Asset tag</SortableTh>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>Name</SortableTh>
                <TableHead>Type</TableHead>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>Status</SortableTh>
                <SortableTh {...sortProps} column="site" active={params.sort === 'site'}>Site</SortableTh>
                <SortableTh {...sortProps} column="holder" active={params.sort === 'holder'}>Holder</SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, type, site, holder }) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/equipment/${item.id}`} className="hover:underline">{item.assetTag}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/equipment/${item.id}`} className="font-medium text-slate-900 hover:underline">
                      {item.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{type?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'in_service' ? 'success' : 'warning'}>
                      {item.status.replace('_', ' ')}
                    </Badge>
                    {item.isMissing ? <Badge variant="destructive" className="ml-1">missing</Badge> : null}
                  </TableCell>
                  <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">
                    {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/equipment"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
