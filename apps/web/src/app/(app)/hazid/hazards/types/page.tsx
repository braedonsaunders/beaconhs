// Hazard types (color-coded categories) — full table with search + usage
// counts. Legacy showed name / color / icon / description plus the
// hazard-count per type so admins know which categories actually get used.

import Link from 'next/link'
import { Palette } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
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
import { hazidHazardTypes, hazidHazards } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { HazidSubNav } from '../../_subnav'

export const metadata = { title: 'Hazard types' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'created', 'hazards'] as const

export default async function HazardTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireModuleManage('hazid')

  const { rows, total } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(hazidHazardTypes.name, term), ilike(hazidHazardTypes.description, term))
      if (cond) filters.push(cond)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'created'
        ? [
            params.dir === 'asc'
              ? asc(hazidHazardTypes.createdAt)
              : desc(hazidHazardTypes.createdAt),
          ]
        : params.sort === 'hazards'
          ? [
              params.dir === 'asc'
                ? asc(sql`count(distinct ${hazidHazards.id})`)
                : desc(sql`count(distinct ${hazidHazards.id})`),
            ]
          : [params.dir === 'asc' ? asc(hazidHazardTypes.name) : desc(hazidHazardTypes.name)]

    const [tot] = await tx.select({ c: count() }).from(hazidHazardTypes).where(whereClause)

    const data = await tx
      .select({
        type: hazidHazardTypes,
        hazardCount:
          sql<number>`count(distinct case when ${hazidHazards.deletedAt} is null then ${hazidHazards.id} end)`.mapWith(
            Number,
          ),
      })
      .from(hazidHazardTypes)
      .leftJoin(hazidHazards, eq(hazidHazards.hazardTypeId, hazidHazardTypes.id))
      .where(whereClause)
      .groupBy(hazidHazardTypes.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    return { rows: data, total: Number(tot?.c ?? 0) }
  })

  const sortProps = { basePath: '/hazid/hazards/types', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid/hazards/types" />
          <PageHeader
            title="Hazard types"
            description="Categorical buckets (mechanical, chemical, electrical…) for organizing the hazard bank. Color is shown alongside hazards in the assessment editor."
            actions={
              <Link href="/hazid/hazards/types/new">
                <Button>New hazard type</Button>
              </Link>
            }
          />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search hazard types…" />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Palette size={32} />}
          title={params.q ? `No types match "${params.q}"` : 'No hazard types yet'}
          description="Start with the basic categories most jobs see — chemical, mechanical, electrical, biological, ergonomic."
          action={
            <Link href="/hazid/hazards/types/new">
              <Button>Add a type</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Name
                </SortableTh>
                <TableHead className="w-32">Color</TableHead>
                <TableHead className="w-24">Icon key</TableHead>
                <TableHead>Description</TableHead>
                <SortableTh {...sortProps} column="hazards" active={params.sort === 'hazards'}>
                  Hazards
                </SortableTh>
                <SortableTh {...sortProps} column="created" active={params.sort === 'created'}>
                  Created
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ type, hazardCount }) => (
                <TableRow key={type.id}>
                  <TableCell>
                    <Link
                      href={`/hazid/hazards/types/${type.id}/edit`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {type.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-4 w-4 rounded border border-slate-200"
                        style={{ background: type.color }}
                        aria-hidden
                      />
                      <code className="text-xs text-slate-600">{type.color}</code>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {type.iconKey ? (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                        {type.iconKey}
                      </code>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="line-clamp-2 max-w-md text-xs text-slate-600">
                    {type.description ?? '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <Badge variant="secondary">{Number(hazardCount ?? 0)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 tabular-nums">
                    {type.createdAt ? new Date(type.createdAt).toLocaleDateString() : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/hazid/hazards/types"
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

// Silence unused
export function _hazardTypesReady() {
  return [isNull].length > 0
}
