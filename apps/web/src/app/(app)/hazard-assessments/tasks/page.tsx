// HazID task library — reusable task templates with default hazards / controls
// that crews drop onto a job-specific assessment. Legacy showed the task
// name, default controls, the number of linked hazards, SWP / SJP document
// pointers, location pinning count, and usage across assessments. This page
// reproduces all of those columns.

import Link from 'next/link'
import { ClipboardList, FileText } from 'lucide-react'
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
  hazidAssessmentTasks,
  hazidHazards,
  hazidLocationTasks,
  hazidTasks,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { HazidSubNav } from '../_subnav'

export const metadata = { title: 'Task library' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'hazards', 'updated', 'usage'] as const

export default async function TaskLibraryPage({
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
  const docFilter = pickString(sp.docs) // 'swp' | 'sjp' | 'either' | 'neither'
  const hazardSizeFilter = pickString(sp.hazardSize)
  const ctx = await requireRequestContext()

  const { rows, total, hazardNamesById, locationCountByTask } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(hazidTasks.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(hazidTasks.name, term),
        ilike(hazidTasks.description, term),
        ilike(hazidTasks.controls, term),
      )
      if (cond) filters.push(cond)
    }
    if (docFilter === 'swp') filters.push(sql`${hazidTasks.swpDocumentId} IS NOT NULL`)
    if (docFilter === 'sjp') filters.push(sql`${hazidTasks.sjpDocumentId} IS NOT NULL`)
    if (docFilter === 'either') {
      filters.push(
        sql`(${hazidTasks.swpDocumentId} IS NOT NULL OR ${hazidTasks.sjpDocumentId} IS NOT NULL)`,
      )
    }
    if (docFilter === 'neither') {
      filters.push(
        sql`(${hazidTasks.swpDocumentId} IS NULL AND ${hazidTasks.sjpDocumentId} IS NULL)`,
      )
    }
    if (hazardSizeFilter === 'empty') {
      filters.push(sql`jsonb_array_length(${hazidTasks.hazardIds}) = 0`)
    } else if (hazardSizeFilter === 'small') {
      filters.push(sql`jsonb_array_length(${hazidTasks.hazardIds}) BETWEEN 1 AND 5`)
    } else if (hazardSizeFilter === 'large') {
      filters.push(sql`jsonb_array_length(${hazidTasks.hazardIds}) > 5`)
    }
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'hazards'
        ? [
            params.dir === 'asc'
              ? asc(sql`jsonb_array_length(${hazidTasks.hazardIds})`)
              : desc(sql`jsonb_array_length(${hazidTasks.hazardIds})`),
          ]
        : params.sort === 'updated'
          ? [params.dir === 'asc' ? asc(hazidTasks.updatedAt) : desc(hazidTasks.updatedAt)]
          : params.sort === 'usage'
            ? [
                params.dir === 'asc'
                  ? asc(sql`count(distinct ${hazidAssessmentTasks.id})`)
                  : desc(sql`count(distinct ${hazidAssessmentTasks.id})`),
              ]
            : [params.dir === 'asc' ? asc(hazidTasks.name) : desc(hazidTasks.name)]

    const [tot] = await tx.select({ c: count() }).from(hazidTasks).where(whereClause)

    const data = await tx
      .select({
        task: hazidTasks,
        usageCount: sql<number>`count(distinct ${hazidAssessmentTasks.id})`.mapWith(Number),
      })
      .from(hazidTasks)
      .leftJoin(hazidAssessmentTasks, eq(hazidAssessmentTasks.taskId, hazidTasks.id))
      .where(whereClause)
      .groupBy(hazidTasks.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    // Collect first-N hazard previews per task.
    const allHazardIds = new Set<string>()
    for (const r of data) for (const id of r.task.hazardIds) allHazardIds.add(id)
    const hazardLookup = new Map<string, string>()
    if (allHazardIds.size > 0) {
      const names = await tx
        .select({ id: hazidHazards.id, name: hazidHazards.name })
        .from(hazidHazards)
        .where(inArray(hazidHazards.id, Array.from(allHazardIds)))
      for (const n of names) hazardLookup.set(n.id, n.name)
    }

    // Location-pin count per task (how many sites pre-select this task).
    const locCounts = await tx
      .select({ taskId: hazidLocationTasks.taskId, c: count() })
      .from(hazidLocationTasks)
      .groupBy(hazidLocationTasks.taskId)
    const locMap = new Map<string, number>()
    for (const r of locCounts) locMap.set(r.taskId, Number(r.c))

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      hazardNamesById: hazardLookup,
      locationCountByTask: locMap,
    }
  })

  const sortProps = { basePath: '/hazard-assessments/tasks', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazard-assessments/tasks" />
          <PageHeader
            title="Task library"
            description="Reusable task templates with default hazards / controls. Crews pull these into a job-specific assessment and tweak per-site."
            actions={
              <Link href="/hazard-assessments/tasks/new">
                <Button>New task</Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search tasks, controls…" />
            <FilterChips
              basePath="/hazard-assessments/tasks"
              currentParams={sp}
              paramKey="hazardSize"
              label="Hazards"
              options={[
                { value: 'empty', label: 'No hazards' },
                { value: 'small', label: '1–5' },
                { value: 'large', label: '6+' },
              ]}
            />
            <FilterChips
              basePath="/hazard-assessments/tasks"
              currentParams={sp}
              paramKey="docs"
              label="Docs"
              options={[
                { value: 'swp', label: 'Has SWP' },
                { value: 'sjp', label: 'Has SJP' },
                { value: 'either', label: 'Has either' },
                { value: 'neither', label: 'No docs' },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title={
            params.q || docFilter || hazardSizeFilter ? 'No tasks match these filters' : 'No tasks'
          }
          description="Build common job steps for crews to pull into an assessment."
          action={
            <Link href="/hazard-assessments/tasks/new">
              <Button>Add task</Button>
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
                <SortableTh {...sortProps} column="hazards" active={params.sort === 'hazards'}>
                  Linked hazards
                </SortableTh>
                <TableHead>Preview hazards</TableHead>
                <TableHead>Default controls</TableHead>
                <TableHead className="w-24">SWP / SJP</TableHead>
                <TableHead className="w-24">Pinned to sites</TableHead>
                <SortableTh {...sortProps} column="usage" active={params.sort === 'usage'}>
                  Used in assessments
                </SortableTh>
                <SortableTh {...sortProps} column="updated" active={params.sort === 'updated'}>
                  Updated
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ task, usageCount }) => {
                const preview = task.hazardIds
                  .slice(0, 3)
                  .map((id) => hazardNamesById.get(id))
                  .filter(Boolean) as string[]
                return (
                  <TableRow key={task.id}>
                    <TableCell>
                      <Link
                        href={`/hazard-assessments/tasks/${task.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {task.name}
                      </Link>
                      {task.description ? (
                        <div className="line-clamp-1 text-xs text-slate-500">
                          {task.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{task.hazardIds.length}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-slate-600 dark:text-slate-400">
                      {preview.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <>
                          {preview.join(', ')}
                          {task.hazardIds.length > 3 ? (
                            <span className="text-slate-400"> +{task.hazardIds.length - 3}</span>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="line-clamp-2 max-w-md text-xs text-slate-600 dark:text-slate-400">
                      {task.controls ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {task.swpDocumentId ? (
                          <Badge variant="outline" className="text-xs">
                            <FileText size={10} className="mr-1" /> SWP
                          </Badge>
                        ) : null}
                        {task.sjpDocumentId ? (
                          <Badge variant="outline" className="text-xs">
                            <FileText size={10} className="mr-1" /> SJP
                          </Badge>
                        ) : null}
                        {!task.swpDocumentId && !task.sjpDocumentId ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <Badge variant="secondary">{locationCountByTask.get(task.id) ?? 0}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <Badge variant="secondary">{Number(usageCount ?? 0)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums">
                      {task.updatedAt ? new Date(task.updatedAt).toLocaleDateString() : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/hazard-assessments/tasks"
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
