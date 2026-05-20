// HazID hazard library — the catalog of pre-canned hazards crews can pull
// into a job-specific assessment. The legacy page rendered a wide table with
// columns: name, type, standard controls, risks, photo indicator, usage count
// across assessments, last-updated. This page mirrors that depth and adds the
// type-filter chip strip + search + sort + pagination shared with the rest of
// the new app's list pages.

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
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
import {
  hazidAssessmentHazards,
  hazidHazardTypes,
  hazidHazards,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { HazidSubNav } from '../_subnav'
import { HazardLibraryDrawers, type EditHazardDefaults } from './_drawers'

export const metadata = { title: 'Hazard library' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'type', 'updated', 'usage'] as const

// ---------- Server actions (drawer-driven, typed object inputs) ----------

async function createHazardAction(input: {
  name: string
  hazardTypeId: string | null
  description: string | null
  standardControls: string | null
  risks: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }
  const [row] = await ctx.db((tx) =>
    tx
      .insert(hazidHazards)
      .values({
        tenantId: ctx.tenantId!,
        name,
        hazardTypeId: input.hazardTypeId,
        description: input.description,
        standardControls: input.standardControls,
        risks: input.risks,
      })
      .returning(),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard',
    entityId: row?.id,
    action: 'create',
    summary: `Created hazard "${name}"`,
  })
  revalidatePath('/hazid/hazards')
  return { ok: true }
}

async function updateHazardAction(input: {
  id: string
  name: string
  hazardTypeId: string | null
  description: string | null
  standardControls: string | null
  risks: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  if (!input.id) return { ok: false, error: 'Missing hazard id' }
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }
  await ctx.db((tx) =>
    tx
      .update(hazidHazards)
      .set({
        name,
        hazardTypeId: input.hazardTypeId,
        description: input.description,
        standardControls: input.standardControls,
        risks: input.risks,
      })
      .where(eq(hazidHazards.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_hazard',
    entityId: input.id,
    action: 'update',
    summary: 'Updated hazard',
  })
  revalidatePath('/hazid/hazards')
  revalidatePath(`/hazid/hazards/${input.id}`)
  return { ok: true }
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
  const ctx = await requireRequestContext()

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
      .select({ id: hazidHazardTypes.id, name: hazidHazardTypes.name, color: hazidHazardTypes.color })
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
        .where(eq(hazidHazards.id, editId))
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

  const sortProps = { basePath: '/hazid/hazards', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid/hazards" />
          <PageHeader
            title="Hazard library"
            description="The bank of known hazards crews can pull into a job-specific assessment."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/hazid/hazards/types" className="text-sm text-teal-700 hover:underline">
                  Manage types →
                </Link>
                <Link href="/hazid/hazards?drawer=new-hazard" scroll={false}>
                  <Button>New hazard</Button>
                </Link>
              </div>
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder="Search hazards, controls, risks…" />
          </div>
          {typeOptions.length > 0 ? (
            <FilterChips
              basePath="/hazid/hazards"
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
            basePath="/hazid/hazards"
            currentParams={sp}
            paramKey="photo"
            label="Photo"
            options={[
              { value: 'with', label: 'Has photo' },
              { value: 'without', label: 'No photo' },
            ]}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert size={32} />}
          title={
            params.q || typeFilter || photoFilter
              ? 'No hazards match these filters'
              : 'No hazards yet'
          }
          description="Build out a hazard bank so crews don't have to invent it on every job."
          action={
            <Link href="/hazid/hazards?drawer=new-hazard" scroll={false}>
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
                      href={`/hazid/hazards/${h.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {h.name}
                    </Link>
                    {h.description ? (
                      <div className="text-xs text-slate-500 line-clamp-1">{h.description}</div>
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
                  <TableCell className="max-w-md text-slate-600 text-xs">
                    {h.standardControls ? (
                      <span className="line-clamp-2">{h.standardControls}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs text-slate-600 text-xs">
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
                    {h.updatedAt ? new Date(h.updatedAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/hazid/hazards?drawer=edit-hazard&id=${h.id}`}
                      scroll={false}
                      aria-label={`Edit ${h.name}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Pencil size={14} />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/hazid/hazards"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <HazardLibraryDrawers
        openDrawer={
          drawer === 'new-hazard'
            ? 'new-hazard'
            : drawer === 'edit-hazard'
              ? 'edit-hazard'
              : null
        }
        closeHref="/hazid/hazards"
        types={typeOptions}
        createAction={createHazardAction}
        updateAction={updateHazardAction}
        editDefaults={editTarget}
      />
    </ListPageLayout>
  )
}
