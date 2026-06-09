// Hazard sets — pre-bundled selections of hazards admins can drop onto an
// assessment in a single click. Legacy showed the set's name, the hazards in
// it (counted + first-N preview), description, when it was last updated, and
// who created it. This page mirrors that depth.

import Link from 'next/link'
import { Boxes } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
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
import { hazidAssessmentTypes, hazidHazardSets, hazidHazards } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { HazidSubNav } from '../../_subnav'

export const metadata = { title: 'Hazard sets' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'size', 'updated'] as const

export default async function HazardSetsPage({
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
  const sizeFilter = pickStringParam(sp.size) // 'empty' | 'small' | 'large'
  const ctx = await requireModuleManage('hazid')

  const { rows, total, hazardNamesById, usageBySet } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(hazidHazardSets.name, term),
        ilike(hazidHazardSets.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (sizeFilter === 'empty') {
      filters.push(sql`jsonb_array_length(${hazidHazardSets.hazardIds}) = 0`)
    } else if (sizeFilter === 'small') {
      filters.push(sql`jsonb_array_length(${hazidHazardSets.hazardIds}) BETWEEN 1 AND 5`)
    } else if (sizeFilter === 'large') {
      filters.push(sql`jsonb_array_length(${hazidHazardSets.hazardIds}) > 5`)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'size'
        ? [
            params.dir === 'asc'
              ? asc(sql`jsonb_array_length(${hazidHazardSets.hazardIds})`)
              : desc(sql`jsonb_array_length(${hazidHazardSets.hazardIds})`),
          ]
        : params.sort === 'updated'
          ? [
              params.dir === 'asc'
                ? asc(hazidHazardSets.updatedAt)
                : desc(hazidHazardSets.updatedAt),
            ]
          : [params.dir === 'asc' ? asc(hazidHazardSets.name) : desc(hazidHazardSets.name)]

    const [tot] = await tx
      .select({ c: count() })
      .from(hazidHazardSets)
      .where(whereClause)

    const data = await tx
      .select()
      .from(hazidHazardSets)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    // Collect all hazard IDs across the returned sets so we can show their
    // names as a preview without an N+1 query.
    const allHazardIds = new Set<string>()
    for (const r of data) for (const id of r.hazardIds) allHazardIds.add(id)
    const hazardLookup = new Map<string, string>()
    if (allHazardIds.size > 0) {
      const names = await tx
        .select({ id: hazidHazards.id, name: hazidHazards.name })
        .from(hazidHazards)
        .where(inArray(hazidHazards.id, Array.from(allHazardIds)))
      for (const n of names) hazardLookup.set(n.id, n.name)
    }

    // How many assessment types declare this set as their default.
    const usage = await tx
      .select({
        setId: hazidAssessmentTypes.defaultHazardSetId,
        c: count(),
      })
      .from(hazidAssessmentTypes)
      .where(isNull(hazidAssessmentTypes.deletedAt))
      .groupBy(hazidAssessmentTypes.defaultHazardSetId)
    const usageMap = new Map<string, number>()
    for (const u of usage) {
      if (u.setId) usageMap.set(u.setId, Number(u.c))
    }

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      hazardNamesById: hazardLookup,
      usageBySet: usageMap,
    }
  })

  const sortProps = { basePath: '/hazid/hazards/sets', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid/hazards/sets" />
          <PageHeader
            title="Hazard sets"
            description="Bundles of related hazards that can be added to an assessment in one click. Assessment types can pin a default set so new assessments preload it."
            actions={
              <Link href="/hazid/hazards/sets/new">
                <Button>New hazard set</Button>
              </Link>
            }
          />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search hazard sets…" />
          </div>
          <FilterChips
            basePath="/hazid/hazards/sets"
            currentParams={sp}
            paramKey="size"
            label="Size"
            options={[
              { value: 'empty', label: 'Empty' },
              { value: 'small', label: '1–5 hazards' },
              { value: 'large', label: '6+ hazards' },
            ]}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Boxes size={32} />}
          title={params.q || sizeFilter ? 'No sets match these filters' : 'No hazard sets yet'}
          description="Group commonly-co-occurring hazards together to speed up assessments."
          action={
            <Link href="/hazid/hazards/sets/new">
              <Button>Create one</Button>
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
                <SortableTh {...sortProps} column="size" active={params.sort === 'size'}>
                  Hazards in set
                </SortableTh>
                <TableHead>Preview</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-24">Used as default</TableHead>
                <SortableTh {...sortProps} column="updated" active={params.sort === 'updated'}>
                  Updated
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const previewNames = r.hazardIds
                  .slice(0, 3)
                  .map((id) => hazardNamesById.get(id))
                  .filter(Boolean) as string[]
                const usage = usageBySet.get(r.id) ?? 0
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/hazid/hazards/sets/${r.id}/edit`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.hazardIds.length}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {previewNames.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <>
                          {previewNames.join(', ')}
                          {r.hazardIds.length > 3 ? (
                            <span className="text-slate-400">
                              {' '}
                              +{r.hazardIds.length - 3} more
                            </span>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="max-w-md text-slate-600 text-xs line-clamp-2">
                      {r.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      {usage > 0 ? (
                        <Badge variant="success">{usage}</Badge>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums">
                      {r.updatedAt
                        ? new Date(r.updatedAt).toLocaleDateString()
                        : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/hazid/hazards/sets"
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

function pickStringParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}
