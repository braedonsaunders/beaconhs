// Hazard sets — pre-bundled selections of hazards admins can drop onto an
// assessment in a single click. Legacy showed the set's name, the hazards in
// it (counted + first-N preview), description, when it was last updated, and
// who created it. This page mirrors that depth.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Boxes, Pencil } from 'lucide-react'
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
import {
  hazidAssessmentTypes,
  hazidHazardSets,
  hazidHazardTypes,
  hazidHazards,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { formatDate } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { HazidSubNav } from '../../_subnav'
import { createHazardSet, deleteHazardSet, updateHazardSet } from '../../_actions'
import { HazardSetDrawers, type EditHazardSetDefaults } from './_drawers'

export const metadata = { title: 'Hazard sets' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'size', 'updated'] as const

async function createHazardSetAction(formData: FormData) {
  'use server'
  await createHazardSet(formData)
  redirect('/hazard-assessments/hazards/sets')
}

async function updateHazardSetAction(formData: FormData) {
  'use server'
  await updateHazardSet(formData)
  redirect('/hazard-assessments/hazards/sets')
}

async function deleteHazardSetAction(formData: FormData) {
  'use server'
  await deleteHazardSet(formData)
  redirect('/hazard-assessments/hazards/sets')
}

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
  const sizeFilter = pickString(sp.size) // 'empty' | 'small' | 'large'
  const drawer = pickString(sp.drawer)
  const editId = pickString(sp.id)
  const ctx = await requireModuleManage('hazid')

  const { rows, total, hazardNamesById, usageBySet, hazardOptions, editTarget } = await ctx.db(
    async (tx) => {
      const filters: SQL<unknown>[] = []
      if (params.q) {
        const term = `%${params.q}%`
        const cond = or(ilike(hazidHazardSets.name, term), ilike(hazidHazardSets.description, term))
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

      const [tot] = await tx.select({ c: count() }).from(hazidHazardSets).where(whereClause)

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

      const hazards = await tx
        .select({ id: hazidHazards.id, name: hazidHazards.name, typeName: hazidHazardTypes.name })
        .from(hazidHazards)
        .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
        .where(isNull(hazidHazards.deletedAt))
        .orderBy(asc(hazidHazards.name))

      let editTarget: EditHazardSetDefaults | null = null
      if (drawer === 'edit-hazard-set' && editId) {
        const [target] = await tx
          .select()
          .from(hazidHazardSets)
          .where(eq(hazidHazardSets.id, editId))
          .limit(1)
        if (target) {
          editTarget = {
            id: target.id,
            name: target.name,
            description: target.description,
            hazardIds: target.hazardIds,
          }
        }
      }

      return {
        rows: data,
        total: Number(tot?.c ?? 0),
        hazardNamesById: hazardLookup,
        usageBySet: usageMap,
        hazardOptions: hazards.map((h) => ({
          value: h.id,
          label: h.name,
          sublabel: h.typeName ?? undefined,
        })),
        editTarget,
      }
    },
  )

  const sortProps = {
    basePath: '/hazard-assessments/hazards/sets',
    currentParams: sp,
    dir: params.dir,
  }

  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazard-assessments/hazards/sets" />
          <PageHeader
            title="Hazard sets"
            description="Hazard bundles added to an assessment in one click."
            actions={
              <Link href="/hazard-assessments/hazards/sets?drawer=new-hazard-set" scroll={false}>
                <Button>New hazard set</Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search hazard sets…" />
            <FilterChips
              basePath="/hazard-assessments/hazards/sets"
              currentParams={sp}
              paramKey="size"
              label="Size"
              options={[
                { value: 'empty', label: 'Empty' },
                { value: 'small', label: '1–5 hazards' },
                { value: 'large', label: '6+ hazards' },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Boxes size={32} />}
          title={params.q || sizeFilter ? 'No sets match these filters' : 'No hazard sets'}
          description="Group commonly-co-occurring hazards together to speed up assessments."
          action={
            <Link href="/hazard-assessments/hazards/sets?drawer=new-hazard-set" scroll={false}>
              <Button>New hazard set</Button>
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
                <TableHead className="w-10" />
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
                        href={`/hazard-assessments/hazards/sets?drawer=edit-hazard-set&id=${r.id}`}
                        scroll={false}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.hazardIds.length}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                      {previewNames.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <>
                          {previewNames.join(', ')}
                          {r.hazardIds.length > 3 ? (
                            <span className="text-slate-400"> +{r.hazardIds.length - 3} more</span>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="line-clamp-2 max-w-md text-xs text-slate-600 dark:text-slate-400">
                      {r.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      {usage > 0 ? (
                        <Badge variant="success">{usage}</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums">
                      {r.updatedAt
                        ? formatDate(new Date(r.updatedAt), ctx.timezone, ctx.locale)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/hazard-assessments/hazards/sets?drawer=edit-hazard-set&id=${r.id}`}
                        scroll={false}
                        aria-label={`Edit ${r.name}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil size={14} />
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/hazard-assessments/hazards/sets"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <HazardSetDrawers
        openDrawer={
          drawer === 'new-hazard-set'
            ? 'new-hazard-set'
            : drawer === 'edit-hazard-set'
              ? 'edit-hazard-set'
              : null
        }
        closeHref="/hazard-assessments/hazards/sets"
        hazards={hazardOptions}
        createAction={createHazardSetAction}
        updateAction={updateHazardSetAction}
        deleteAction={deleteHazardSetAction}
        editDefaults={editTarget}
      />
    </ListPageLayout>
  )
}
