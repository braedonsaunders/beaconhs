import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, type SQL } from 'drizzle-orm'
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
import { csPermits, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'Confined Space' }

const SORTS = ['reference', 'status', 'issued_at', 'expires_at'] as const

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'active', label: 'Active' },
  { value: 'closed', label: 'Closed' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default async function ConfinedSpacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'issued_at', dir: 'desc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = ilike(csPermits.title, term)
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(csPermits.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(csPermits.reference) : desc(csPermits.reference)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(csPermits.status) : desc(csPermits.status)]
          : params.sort === 'expires_at'
            ? [params.dir === 'asc' ? asc(csPermits.expiresAt) : desc(csPermits.expiresAt)]
            : [params.dir === 'asc' ? asc(csPermits.issuedAt) : desc(csPermits.issuedAt)]

    const [tot] = await tx.select({ c: count() }).from(csPermits).where(whereClause)
    const data = await tx
      .select({ permit: csPermits, site: orgUnits })
      .from(csPermits)
      .leftJoin(orgUnits, eq(orgUnits.id, csPermits.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const ss = await tx
      .select({ s: csPermits.status, c: count() })
      .from(csPermits)
      .groupBy(csPermits.status)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/confined-space', currentParams: sp, dir: params.dir }
  const now = Date.now()

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Confined Space"
            description="Entry permits, atmospheric monitoring, rescue plans. Permits expire automatically when their window passes."
            actions={
              <Link href="/confined-space/new">
                <Button>New permit</Button>
              </Link>
            }
          />
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href="/confined-space"
              className="rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700"
            >
              Permits
            </Link>
            <Link
              href="/confined-space/sensors"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Atmospheric sensors
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search by permit title" />
          </div>
          <FilterChips
            basePath="/confined-space"
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
          icon={<ShieldCheck size={32} />}
          title="No permits yet"
          description="Open a new permit before any confined-space entry."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="reference" active={params.sort === 'reference'}>Ref</SortableTh>
                <TableHead>Title</TableHead>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>Status</SortableTh>
                <TableHead>Site</TableHead>
                <SortableTh {...sortProps} column="issued_at" active={params.sort === 'issued_at'}>Issued</SortableTh>
                <SortableTh {...sortProps} column="expires_at" active={params.sort === 'expires_at'}>Expires</SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ permit, site }) => {
                const exp = new Date(permit.expiresAt).getTime()
                const expiringSoon = permit.status === 'active' && exp - now < 60 * 60 * 1000
                return (
                  <TableRow key={permit.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/confined-space/${permit.id}`} className="hover:underline">
                        {permit.reference}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/confined-space/${permit.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {permit.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          permit.status === 'active'
                            ? 'success'
                            : permit.status === 'expired'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {permit.status}
                      </Badge>
                      {expiringSoon ? (
                        <Badge variant="warning" className="ml-1">
                          expires soon
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">
                      {new Date(permit.issuedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {new Date(permit.expiresAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/confined-space"
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
