import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1469477020449a') }
}
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_1469477020449a')}
            description={tGenerated('m_0b483f48c89125')}
            actions={
              <Link href="/hazard-assessments/types/new">
                <Button>
                  <GeneratedText id="m_1d23e917eeb2e4" />
                </Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0ce3985d801819')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="style"
              label={tGenerated('m_03cf3a97d03fef')}
              options={[
                { value: 'task_based', label: 'Task-based', count: taskBasedCount },
                { value: 'hazard_based', label: 'Hazard-based', count: hazardBasedCount },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<ListChecks size={32} />}
              title={tGeneratedValue(
                !params.q && !styleFilter
                  ? tGenerated('m_0d3b5a36a8779b')
                  : tGenerated('m_17d7f44539abd3'),
              )}
              description={tGeneratedValue(
                !params.q && !styleFilter
                  ? tGenerated('m_0d998a4fb9f946')
                  : tGenerated('m_1cbb449aadde60'),
              )}
              action={
                !params.q && !styleFilter ? (
                  <Link href="/hazard-assessments/types/new">
                    <Button>
                      <GeneratedText id="m_14df422e6bfe41" />
                    </Button>
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
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_0715227000cfd5" />
                    </TableHead>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="style"
                      active={params.sort === 'style'}
                    >
                      <GeneratedText id="m_03cf3a97d03fef" />
                    </SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link
                            href={`/hazard-assessments/types/${r.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={r.name} />
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <GeneratedValue
                              value={
                                r.hasPPE ? (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_18391e161b9ed6" />
                                  </Badge>
                                ) : null
                              }
                            />
                            <GeneratedValue
                              value={
                                r.hasQuestions ? (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_0ef5343512ffa9" />
                                  </Badge>
                                ) : null
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={styleLabel(r.style)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
            </div>
          )
        }
      />
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
