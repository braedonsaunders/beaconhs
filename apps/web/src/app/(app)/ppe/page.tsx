import Link from 'next/link'
import { HardHat } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import {
  Badge,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { people, ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'PPE' }

const SORTS = ['type', 'serial', 'size', 'status', 'holder'] as const

const STATUS_OPTIONS = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'issued', label: 'Issued' },
  { value: 'returned', label: 'Returned' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'discarded', label: 'Discarded' },
  { value: 'expired', label: 'Expired' },
]

export default async function PpePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'type', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(ppeItems.serialNumber, term), ilike(ppeTypes.name, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(ppeItems.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'serial'
        ? [params.dir === 'asc' ? asc(ppeItems.serialNumber) : desc(ppeItems.serialNumber)]
        : params.sort === 'size'
          ? [params.dir === 'asc' ? asc(ppeItems.size) : desc(ppeItems.size)]
          : params.sort === 'status'
            ? [params.dir === 'asc' ? asc(ppeItems.status) : desc(ppeItems.status)]
            : params.sort === 'holder'
              ? [params.dir === 'asc' ? asc(people.lastName) : desc(people.lastName)]
              : [params.dir === 'asc' ? asc(ppeTypes.name) : desc(ppeTypes.name)]

    const [tot] = await tx
      .select({ c: count() })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .where(whereClause)
    const data = await tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
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
      .groupBy(ppeItems.status)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/ppe', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="PPE"
            description="Issue, return, replace, discard — plus scheduled inspections for inspectable PPE."
          />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search type or serial #" />
          </div>
          <FilterChips
            basePath="/ppe"
            currentParams={sp}
            paramKey="status"
            label="Status"
            options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState icon={<HardHat size={32} />} title="No PPE matches" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>Type</SortableTh>
                <SortableTh {...sortProps} column="serial" active={params.sort === 'serial'}>Serial #</SortableTh>
                <SortableTh {...sortProps} column="size" active={params.sort === 'size'}>Size</SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>Status</SortableTh>
                <SortableTh {...sortProps} column="holder" active={params.sort === 'holder'}>Holder</SortableTh>
                <TableHead>Next inspection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, type, holder }) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`/ppe/${item.id}`} className="font-medium text-slate-900 hover:underline">
                      {type.name}
                    </Link>
                  </TableCell>
                  <TableCell>{item.serialNumber ?? '—'}</TableCell>
                  <TableCell>{item.size ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'issued' ? 'success' : item.status === 'in_stock' ? 'secondary' : 'warning'}>
                      {item.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">{item.nextInspectionDue ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/ppe"
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
