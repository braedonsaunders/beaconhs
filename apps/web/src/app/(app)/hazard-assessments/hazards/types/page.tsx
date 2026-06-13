// Hazard types (color-coded categories) — full table with search + usage
// counts. Legacy showed name / color / icon / description plus the
// hazard-count per type so admins know which categories actually get used.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Palette, Pencil } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
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
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { HazidSubNav } from '../../_subnav'
import { createHazardType, deleteHazardType, updateHazardType } from '../../_actions'
import { HazardTypeDrawers, type EditHazardTypeDefaults } from './_drawers'

export const metadata = { title: 'Hazard types' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'created', 'hazards'] as const

async function createHazardTypeAction(formData: FormData) {
  'use server'
  await createHazardType(formData)
  redirect('/hazard-assessments/hazards/types')
}

async function updateHazardTypeAction(formData: FormData) {
  'use server'
  await updateHazardType(formData)
  redirect('/hazard-assessments/hazards/types')
}

async function deleteHazardTypeAction(formData: FormData) {
  'use server'
  await deleteHazardType(formData)
  redirect('/hazard-assessments/hazards/types')
}

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
  const drawer = pickString(sp.drawer)
  const editId = pickString(sp.id)
  const ctx = await requireModuleManage('hazid')

  const { rows, total, editTarget } = await ctx.db(async (tx) => {
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

    let editTarget: EditHazardTypeDefaults | null = null
    if (drawer === 'edit-hazard-type' && editId) {
      const [target] = await tx
        .select()
        .from(hazidHazardTypes)
        .where(eq(hazidHazardTypes.id, editId))
        .limit(1)
      if (target) {
        editTarget = {
          id: target.id,
          name: target.name,
          color: target.color,
          iconKey: target.iconKey,
          description: target.description,
        }
      }
    }

    return { rows: data, total: Number(tot?.c ?? 0), editTarget }
  })

  const sortProps = {
    basePath: '/hazard-assessments/hazards/types',
    currentParams: sp,
    dir: params.dir,
  }

  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazard-assessments/hazards/types" />
          <PageHeader
            title="Hazard types"
            description="Categories for organizing the hazard bank."
            actions={
              <Link href="/hazard-assessments/hazards/types?drawer=new-hazard-type" scroll={false}>
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
          title={params.q ? `No types match "${params.q}"` : 'No hazard types'}
          description="Start with common categories — chemical, mechanical, electrical, biological, ergonomic."
          action={
            <Link href="/hazard-assessments/hazards/types?drawer=new-hazard-type" scroll={false}>
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
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ type, hazardCount }) => (
                <TableRow key={type.id}>
                  <TableCell>
                    <Link
                      href={`/hazard-assessments/hazards/types?drawer=edit-hazard-type&id=${type.id}`}
                      scroll={false}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {type.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-4 w-4 rounded border border-slate-200 dark:border-slate-800"
                        style={{ background: type.color }}
                        aria-hidden
                      />
                      <code className="text-xs text-slate-600 dark:text-slate-400">
                        {type.color}
                      </code>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {type.iconKey ? (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {type.iconKey}
                      </code>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="line-clamp-2 max-w-md text-xs text-slate-600 dark:text-slate-400">
                    {type.description ?? '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <Badge variant="secondary">{Number(hazardCount ?? 0)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 tabular-nums">
                    {type.createdAt ? new Date(type.createdAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/hazard-assessments/hazards/types?drawer=edit-hazard-type&id=${type.id}`}
                      scroll={false}
                      aria-label={`Edit ${type.name}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      <Pencil size={14} />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/hazard-assessments/hazards/types"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <HazardTypeDrawers
        openDrawer={
          drawer === 'new-hazard-type'
            ? 'new-hazard-type'
            : drawer === 'edit-hazard-type'
              ? 'edit-hazard-type'
              : null
        }
        closeHref="/hazard-assessments/hazards/types"
        createAction={createHazardTypeAction}
        updateAction={updateHazardTypeAction}
        deleteAction={deleteHazardTypeAction}
        editDefaults={editTarget}
      />
    </ListPageLayout>
  )
}
