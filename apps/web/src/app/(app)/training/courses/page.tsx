import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import {
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
import { trainingCourses } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { DELIVERY_OPTIONS, deliveryLabel } from '../_lib/delivery'
import { startCourse } from './[id]/studio/_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_19deda31dd415b') }
}

const SORTS = ['name', 'code', 'delivery_type', 'valid_for_months'] as const

export default async function TrainingCoursesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const deliveryFilter = pickString(sp.delivery)
  const ctx = await requireRequestContext()
  const canExport =
    can(ctx, 'admin.data.export') &&
    (can(ctx, 'training.read.all') || can(ctx, 'training.course.manage'))
  // Creating courses is a training-management mutation — hide the entry point
  // for everyone else (createCourse re-checks server-side).
  const canManage = canManageModule(ctx, 'training')

  const { rows, total, deliveryCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(trainingCourses.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(trainingCourses.name, term), ilike(trainingCourses.code, term))
      if (cond) filters.push(cond)
    }
    if (deliveryFilter) filters.push(eq(trainingCourses.deliveryType, deliveryFilter as any))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'code'
        ? [params.dir === 'asc' ? asc(trainingCourses.code) : desc(trainingCourses.code)]
        : params.sort === 'delivery_type'
          ? [
              params.dir === 'asc'
                ? asc(trainingCourses.deliveryType)
                : desc(trainingCourses.deliveryType),
            ]
          : params.sort === 'valid_for_months'
            ? [
                params.dir === 'asc'
                  ? asc(trainingCourses.validForMonths)
                  : desc(trainingCourses.validForMonths),
              ]
            : [params.dir === 'asc' ? asc(trainingCourses.name) : desc(trainingCourses.name)]

    const [tot] = await tx.select({ c: count() }).from(trainingCourses).where(whereClause)
    const data = await tx
      .select()
      .from(trainingCourses)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const dd = await tx
      .select({ s: trainingCourses.deliveryType, c: count() })
      .from(trainingCourses)
      .where(isNull(trainingCourses.deletedAt))
      .groupBy(trainingCourses.deliveryType)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      deliveryCounts: Object.fromEntries(dd.map((x) => [x.s, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/training/courses', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_19deda31dd415b')}
            description={tGenerated('m_18d499ef1e1bba')}
            actions={
              <div className="flex items-center gap-2">
                <GeneratedValue
                  value={
                    canExport ? (
                      <Link href={buildExportHref('/training/courses/export.csv', sp)}>
                        <Button variant="outline">
                          <GeneratedText id="m_14c6440eca1edc" />
                        </Button>
                      </Link>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    canManage ? (
                      <form action={startCourse}>
                        <Button type="submit">
                          <GeneratedText id="m_12e35163505050" />
                        </Button>
                      </form>
                    ) : null
                  }
                />
              </div>
            }
          />
          <TrainingSubNav active="courses" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_1b2c753f4c06fa')} />
            <FilterChips
              basePath="/training/courses"
              currentParams={sp}
              paramKey="delivery"
              label={tGenerated('m_03db87cb2e7846')}
              options={DELIVERY_OPTIONS.map((o) => ({ ...o, count: deliveryCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<GraduationCap size={32} />}
              title={tGeneratedValue(
                params.q ? tGenerated('m_0ce129695bc756') : tGenerated('m_0a005e20869528'),
              )}
              description={tGenerated('m_15b0aadbd3c47d')}
              action={
                canManage ? (
                  <form action={startCourse}>
                    <Button type="submit">
                      <GeneratedText id="m_12e35163505050" />
                    </Button>
                  </form>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="code" active={params.sort === 'code'}>
                      <GeneratedText id="m_0570e24c85cf95" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="delivery_type"
                      active={params.sort === 'delivery_type'}
                    >
                      <GeneratedText id="m_03db87cb2e7846" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="valid_for_months"
                      active={params.sort === 'valid_for_months'}
                    >
                      <GeneratedText id="m_18eaa7e8f340b7" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_0ec97074401d0f" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link
                            href={`/training/courses/${c.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={c.name} />
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={c.code} />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={deliveryLabel(c.deliveryType)} />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue
                            value={
                              c.validForMonths ? (
                                <GeneratedText
                                  id="m_1fa77753c09829"
                                  values={{ value0: c.validForMonths }}
                                />
                              ) : (
                                <GeneratedText id="m_1bbc44c1ce26a7" />
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue
                            value={
                              c.durationMinutes ? (
                                <GeneratedText
                                  id="m_190be45ec6aa0b"
                                  values={{ value0: c.durationMinutes }}
                                />
                              ) : (
                                '—'
                              )
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath="/training/courses"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
    </ListPageLayout>
  )
}
