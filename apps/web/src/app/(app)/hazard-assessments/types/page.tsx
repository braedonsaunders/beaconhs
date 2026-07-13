import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
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
import { hazidAssessmentTypes } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'
import { HazidSubNav } from '../_subnav'

export const metadata = { title: 'Assessment types' }
export const dynamic = 'force-dynamic'

const BASE = '/hazard-assessments/types'
const SORTS = ['name', 'style'] as const

function styleLabel(style: 'task_based' | 'hazard_based') {
  return style === 'hazard_based' ? 'Hazard-based' : 'Task-based'
}

export default async function AssessmentTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const styleParam = pickString(sp.style)
  const styleFilter =
    styleParam === 'task_based' || styleParam === 'hazard_based' ? styleParam : undefined
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireModuleManage('hazid')
  const { rows, total, taskBasedCount, hazardBasedCount } = await ctx.db(async (tx) => {
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(hazidAssessmentTypes.name, `%${params.q}%`),
          ilike(hazidAssessmentTypes.description, `%${params.q}%`),
        )
      : undefined
    const active = isNull(hazidAssessmentTypes.deletedAt)
    const style = styleFilter ? eq(hazidAssessmentTypes.style, styleFilter) : undefined
    const where = and(active, search, style)
    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'style'
        ? [dirFn(hazidAssessmentTypes.style), asc(hazidAssessmentTypes.name)]
        : [dirFn(hazidAssessmentTypes.name)]

    const [totalRow, taskRow, hazardRow, result] = await Promise.all([
      tx.select({ c: count() }).from(hazidAssessmentTypes).where(where),
      tx
        .select({ c: count() })
        .from(hazidAssessmentTypes)
        .where(and(active, search, eq(hazidAssessmentTypes.style, 'task_based'))),
      tx
        .select({ c: count() })
        .from(hazidAssessmentTypes)
        .where(and(active, search, eq(hazidAssessmentTypes.style, 'hazard_based'))),
      tx
        .select()
        .from(hazidAssessmentTypes)
        .where(where)
        .orderBy(...orderBy)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
    ])
    return {
      rows: result,
      total: Number(totalRow[0]?.c ?? 0),
      taskBasedCount: Number(taskRow[0]?.c ?? 0),
      hazardBasedCount: Number(hazardRow[0]?.c ?? 0),
    }
  })
  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazard-assessments/types" />
          <PageHeader
            title="Assessment types"
            description="Templates that drive sections, defaults, eligibility, and embedded Builder apps for new assessments."
            actions={
              <Link href="/hazard-assessments/types/new">
                <Button>New assessment type</Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search assessment types…" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="style"
              label="Style"
              options={[
                { value: 'task_based', label: 'Task-based', count: taskBasedCount },
                { value: 'hazard_based', label: 'Hazard-based', count: hazardBasedCount },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={32} />}
          title={!params.q && !styleFilter ? 'No types' : 'No matching types'}
          description={
            !params.q && !styleFilter
              ? "Most crews need at least a 'Standard hazard assessment' and a 'Confined space assessment'."
              : 'Adjust the search or style filter.'
          }
          action={
            !params.q && !styleFilter ? (
              <Link href="/hazard-assessments/types/new">
                <Button>Add a type</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="name"
                  active={params.sort === 'name'}
                >
                  Name
                </SortableTh>
                <TableHead>Optional sections</TableHead>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="style"
                  active={params.sort === 'style'}
                >
                  Style
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      href={`/hazard-assessments/types/${r.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.hasPPE ? <Badge variant="secondary">PPE</Badge> : null}
                      {r.hasQuestions ? <Badge variant="secondary">Q&amp;A</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {styleLabel(r.style)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
      />
    </ListPageLayout>
  )
}
