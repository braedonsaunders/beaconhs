import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
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
import {
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingAssessments,
  trainingCourses,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from '../../_components/training-sub-nav'

export const metadata = { title: 'Assessment types' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'passing', 'questions', 'attempts'] as const

export default async function AssessmentTypesPage({
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
  const ctx = await requireRequestContext()

  const { rows, total } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    filters.push(sql`${trainingAssessmentTypes.deletedAt} IS NULL`)
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(trainingAssessmentTypes.name, term),
        ilike(trainingAssessmentTypes.description, term),
      )
      if (cond) filters.push(cond)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'passing'
        ? [
            params.dir === 'asc'
              ? asc(trainingAssessmentTypes.passingScore)
              : desc(trainingAssessmentTypes.passingScore),
          ]
        : params.sort === 'questions'
          ? [
              params.dir === 'asc'
                ? asc(sql`count(distinct ${trainingAssessmentTypeQuestions.id})`)
                : desc(sql`count(distinct ${trainingAssessmentTypeQuestions.id})`),
            ]
          : params.sort === 'attempts'
            ? [
                params.dir === 'asc'
                  ? asc(sql`count(distinct ${trainingAssessments.id})`)
                  : desc(sql`count(distinct ${trainingAssessments.id})`),
              ]
            : [
                params.dir === 'asc'
                  ? asc(trainingAssessmentTypes.name)
                  : desc(trainingAssessmentTypes.name),
              ]

    const [tot] = await tx
      .select({ c: count() })
      .from(trainingAssessmentTypes)
      .where(whereClause)

    const data = await tx
      .select({
        type: trainingAssessmentTypes,
        course: trainingCourses,
        questionCount: sql<number>`count(distinct ${trainingAssessmentTypeQuestions.id})`.mapWith(
          Number,
        ),
        attemptCount: sql<number>`count(distinct ${trainingAssessments.id})`.mapWith(Number),
      })
      .from(trainingAssessmentTypes)
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAssessmentTypes.courseId))
      .leftJoin(
        trainingAssessmentTypeQuestions,
        eq(trainingAssessmentTypeQuestions.typeId, trainingAssessmentTypes.id),
      )
      .leftJoin(trainingAssessments, eq(trainingAssessments.typeId, trainingAssessmentTypes.id))
      .where(whereClause)
      .groupBy(trainingAssessmentTypes.id, trainingCourses.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    return { rows: data, total: Number(tot?.c ?? 0) }
  })

  const sortProps = {
    basePath: '/training/assessments/types',
    currentParams: sp,
    dir: params.dir,
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Assessment types"
            description="Admin-defined quiz templates. Each has a question bank and a passing score; can optionally award a training record when linked to a course."
            actions={
              <div className="flex items-center gap-2">
                <Link
                  href="/training/assessments"
                  className="text-sm text-teal-700 hover:underline"
                >
                  ← Back to attempts
                </Link>
                <Link href="/training/assessments/types/new">
                  <Button>New assessment type</Button>
                </Link>
              </div>
            }
          />
          <TrainingSubNav active="assessment-types" />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search assessment types" />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title={params.q ? `No assessment types match "${params.q}"` : 'No assessment types yet'}
          description="Create one to start building a graded test bank."
          action={
            <Link href="/training/assessments/types/new">
              <Button>Create your first assessment type</Button>
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
                <TableHead>Linked course</TableHead>
                <SortableTh {...sortProps} column="passing" active={params.sort === 'passing'}>
                  Passing
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="questions"
                  active={params.sort === 'questions'}
                >
                  Questions
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="attempts"
                  active={params.sort === 'attempts'}
                >
                  Attempts
                </SortableTh>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ type, course, questionCount, attemptCount }) => (
                <TableRow key={type.id}>
                  <TableCell>
                    <Link
                      href={`/training/assessments/types/${type.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {type.name}
                    </Link>
                    {type.description ? (
                      <div className="text-xs text-slate-500 line-clamp-1">{type.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {course ? (
                      <Link
                        href={`/training/courses/${course.id}`}
                        className="hover:underline"
                      >
                        {course.name}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{type.passingScore}%</TableCell>
                  <TableCell className="tabular-nums">{questionCount}</TableCell>
                  <TableCell className="tabular-nums">{attemptCount}</TableCell>
                  <TableCell>
                    {type.active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/training/assessments/types"
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
