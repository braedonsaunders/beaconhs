// HazID hazard library — the catalog of pre-canned hazards crews can pull
// into a job-specific assessment. The legacy page rendered a wide table with
// columns: name, type, standard controls, risks, photo indicator, usage count
// across assessments, last-updated. This page mirrors that depth and adds the
// type-filter chip strip + search + sort + pagination shared with the rest of
// the new app's list pages.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ShieldAlert, Image as ImageIcon, Pencil } from 'lucide-react'
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
import { hazidAssessmentHazards, hazidHazardTypes, hazidHazards } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { formatDate } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { HazidSubNav } from '../_subnav'
import { createHazardLibrary, deleteHazardLibrary, updateHazardLibrary } from '../_actions'
import { HazardLibraryDrawers, type EditHazardDefaults } from './_drawers'

export const metadata = { title: 'Hazard library' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'type', 'updated', 'usage'] as const

async function createHazardAction(formData: FormData) {
  'use server'
  await createHazardLibrary(formData)
  redirect('/hazard-assessments/hazards')
}

async function updateHazardAction(formData: FormData) {
  'use server'
  await updateHazardLibrary(formData)
  redirect('/hazard-assessments/hazards')
}

async function deleteHazardAction(formData: FormData) {
  'use server'
  await deleteHazardLibrary(formData)
  redirect('/hazard-assessments/hazards')
}

export default async function HazardsLibraryPage({
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
  const typeFilter = pickString(sp.type)
  const photoFilter = pickString(sp.photo) // 'with' | 'without'
  const drawer = pickString(sp.drawer)
  const editId = pickString(sp.id)
  const ctx = await requireModuleManage('hazid')

  const { rows, total, typeOptions, typeCounts, editTarget } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(hazidHazards.deletedAt)]
    if (typeFilter) filters.push(eq(hazidHazards.hazardTypeId, typeFilter))
    if (photoFilter === 'with') filters.push(sql`${hazidHazards.photoAttachmentId} IS NOT NULL`)
    if (photoFilter === 'without') filters.push(sql`${hazidHazards.photoAttachmentId} IS NULL`)
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(hazidHazards.name, term),
        ilike(hazidHazards.description, term),
        ilike(hazidHazards.standardControls, term),
        ilike(hazidHazards.risks, term),
      )
      if (cond) filters.push(cond)
    }
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'type'
        ? [params.dir === 'asc' ? asc(hazidHazardTypes.name) : desc(hazidHazardTypes.name)]
        : params.sort === 'updated'
          ? [params.dir === 'asc' ? asc(hazidHazards.updatedAt) : desc(hazidHazards.updatedAt)]
          : params.sort === 'usage'
            ? [
                params.dir === 'asc'
                  ? asc(sql`count(distinct ${hazidAssessmentHazards.id})`)
                  : desc(sql`count(distinct ${hazidAssessmentHazards.id})`),
              ]
            : [params.dir === 'asc' ? asc(hazidHazards.name) : desc(hazidHazards.name)]

    const [tot] = await tx
      .select({ c: count() })
      .from(hazidHazards)
      .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
      .where(whereClause)

    const data = await tx
      .select({
        h: hazidHazards,
        type: hazidHazardTypes,
        usageCount: sql<number>`count(distinct ${hazidAssessmentHazards.id})`.mapWith(Number),
      })
      .from(hazidHazards)
      .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
      .leftJoin(hazidAssessmentHazards, eq(hazidAssessmentHazards.hazardId, hazidHazards.id))
      .where(whereClause)
      .groupBy(hazidHazards.id, hazidHazardTypes.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const types = await tx
      .select({
        id: hazidHazardTypes.id,
        name: hazidHazardTypes.name,
        color: hazidHazardTypes.color,
      })
      .from(hazidHazardTypes)
      .orderBy(asc(hazidHazardTypes.name))

    const typeRows = await tx
      .select({ typeId: hazidHazards.hazardTypeId, c: count() })
      .from(hazidHazards)
      .where(isNull(hazidHazards.deletedAt))
      .groupBy(hazidHazards.hazardTypeId)
    const counts: Record<string, number> = {}
    for (const r of typeRows) if (r.typeId) counts[r.typeId] = Number(r.c)

    let editTarget: EditHazardDefaults | null = null
    if (drawer === 'edit-hazard' && editId) {
      const [target] = await tx
        .select({
          id: hazidHazards.id,
          name: hazidHazards.name,
          hazardTypeId: hazidHazards.hazardTypeId,
          description: hazidHazards.description,
          standardControls: hazidHazards.standardControls,
          risks: hazidHazards.risks,
        })
        .from(hazidHazards)
        .where(and(eq(hazidHazards.id, editId), isNull(hazidHazards.deletedAt)))
        .limit(1)
      if (target) {
        editTarget = {
          id: target.id,
          name: target.name,
          hazardTypeId: target.hazardTypeId,
          description: target.description,
          standardControls: target.standardControls,
          risks: target.risks,
        }
      }
    }

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      typeOptions: types,
      typeCounts: counts,
      editTarget,
    }
  })

  const sortProps = { basePath: '/hazard-assessments/hazards', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazard-assessments/hazards" />
          <PageHeader
            title="Hazard library"
            description="The bank of known hazards crews can pull into a job-specific assessment."
            actions={
              <div className="flex items-center gap-2">
                <Link
                  href="/hazard-assessments/hazards/types"
                  className="text-sm text-teal-700 hover:underline"
                >
                  Manage types →
                </Link>
                <Link href="/hazard-assessments/hazards?drawer=new-hazard" scroll={false}>
                  <Button>New hazard</Button>
                </Link>
              </div>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search hazards, controls, risks…" />
            {typeOptions.length > 0 ? (
              <FilterChips
                basePath="/hazard-assessments/hazards"
                currentParams={sp}
                paramKey="type"
                label="Type"
                options={typeOptions.map((t) => ({
                  value: t.id,
                  label: t.name,
                  count: typeCounts[t.id],
                }))}
              />
            ) : null}
            <FilterChips
              basePath="/hazard-assessments/hazards"
              currentParams={sp}
              paramKey="photo"
              label="Photo"
              options={[
                { value: 'with', label: 'Has photo' },
                { value: 'without', label: 'No photo' },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert size={32} />}
          title={
            params.q || typeFilter || photoFilter ? 'No hazards match these filters' : 'No hazards'
          }
          description="Build a hazard bank for crews to pull into job-specific assessments."
          action={
            <Link href="/hazard-assessments/hazards?drawer=new-hazard" scroll={false}>
              <Button>Add a hazard</Button>
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
                <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                  Type
                </SortableTh>
                <TableHead>Standard controls</TableHead>
                <TableHead>Risks</TableHead>
                <TableHead className="w-16">Photo</TableHead>
                <SortableTh {...sortProps} column="usage" active={params.sort === 'usage'}>
                  Used
                </SortableTh>
                <SortableTh {...sortProps} column="updated" active={params.sort === 'updated'}>
                  Updated
                </SortableTh>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ h, type, usageCount }) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <Link
                      href={`/hazard-assessments/hazards?drawer=edit-hazard&id=${h.id}`}
                      scroll={false}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {h.name}
                    </Link>
                    {h.description ? (
                      <div className="line-clamp-1 text-xs text-slate-500">{h.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {type ? (
                      <Badge
                        variant="outline"
                        style={{ borderColor: type.color, color: type.color }}
                      >
                        {type.name}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md text-xs text-slate-600 dark:text-slate-400">
                    {h.standardControls ? (
                      <span className="line-clamp-2">{h.standardControls}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs text-xs text-slate-600 dark:text-slate-400">
                    {h.risks ? (
                      <span className="line-clamp-2">{h.risks}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {h.photoAttachmentId ? (
                      <ImageIcon size={16} className="text-teal-700" />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <Badge variant="secondary">{Number(usageCount ?? 0)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 tabular-nums">
                    {h.updatedAt
                      ? formatDate(new Date(h.updatedAt), ctx.timezone, ctx.locale)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/hazard-assessments/hazards?drawer=edit-hazard&id=${h.id}`}
                      scroll={false}
                      aria-label={`Edit ${h.name}`}
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
            basePath="/hazard-assessments/hazards"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <HazardLibraryDrawers
        openDrawer={
          drawer === 'new-hazard' ? 'new-hazard' : drawer === 'edit-hazard' ? 'edit-hazard' : null
        }
        closeHref="/hazard-assessments/hazards"
        types={typeOptions}
        createAction={createHazardAction}
        updateAction={updateHazardAction}
        deleteAction={deleteHazardAction}
        editDefaults={editTarget}
      />
    </ListPageLayout>
  )
}
