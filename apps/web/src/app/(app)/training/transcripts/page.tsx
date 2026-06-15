import Link from 'next/link'
import { asc, count, desc, eq, ilike, isNull, sql, type SQL, and, or } from 'drizzle-orm'
import { FileText } from 'lucide-react'
import {
  Badge,
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
  people,
  trainingAssessments,
  trainingRecords,
  trainingSkillAssignments,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { TrainingSubNav } from '../_components/training-sub-nav'

export const metadata = { title: 'Transcripts' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'records', 'assessments', 'skills'] as const

export default async function TranscriptsListPage({
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
  const ctx = await requireModuleManage('training')

  const { rows, total } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    filters.push(eq(people.status, 'active'))
    filters.push(isNull(people.deletedAt))
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(people.firstName, term),
        ilike(people.lastName, term),
        ilike(people.employeeNo, term),
      )
      if (cond) filters.push(cond)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'records'
        ? [
            params.dir === 'asc'
              ? asc(sql`count(distinct ${trainingRecords.id})`)
              : desc(sql`count(distinct ${trainingRecords.id})`),
          ]
        : params.sort === 'assessments'
          ? [
              params.dir === 'asc'
                ? asc(sql`count(distinct ${trainingAssessments.id})`)
                : desc(sql`count(distinct ${trainingAssessments.id})`),
            ]
          : params.sort === 'skills'
            ? [
                params.dir === 'asc'
                  ? asc(sql`count(distinct ${trainingSkillAssignments.id})`)
                  : desc(sql`count(distinct ${trainingSkillAssignments.id})`),
              ]
            : [
                params.dir === 'asc' ? asc(people.lastName) : desc(people.lastName),
                params.dir === 'asc' ? asc(people.firstName) : desc(people.firstName),
              ]

    const [tot] = await tx.select({ c: count() }).from(people).where(whereClause)
    const data = await tx
      .select({
        person: people,
        records: sql<number>`count(distinct ${trainingRecords.id})`.mapWith(Number),
        assessments: sql<number>`count(distinct ${trainingAssessments.id})`.mapWith(Number),
        skills: sql<number>`count(distinct ${trainingSkillAssignments.id})`.mapWith(Number),
      })
      .from(people)
      .leftJoin(trainingRecords, eq(trainingRecords.personId, people.id))
      .leftJoin(trainingAssessments, eq(trainingAssessments.personId, people.id))
      .leftJoin(trainingSkillAssignments, eq(trainingSkillAssignments.personId, people.id))
      .where(whereClause)
      .groupBy(people.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return { rows: data, total: Number(tot?.c ?? 0) }
  })

  const sortProps = { basePath: '/training/transcripts', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Transcripts"
            description="Per-person training history: records, assessments, skills, and upcoming expirations."
          />
          <TrainingSubNav active="transcripts" />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search by name or employee number" />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText size={32} />}
          title="No people found"
          description="Add people to build training transcripts."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Name
                </SortableTh>
                <TableHead>Employee #</TableHead>
                <SortableTh {...sortProps} column="records" active={params.sort === 'records'}>
                  Records
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="assessments"
                  active={params.sort === 'assessments'}
                >
                  Assessments
                </SortableTh>
                <SortableTh {...sortProps} column="skills" active={params.sort === 'skills'}>
                  Skills
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ person, records, assessments, skills }) => (
                <TableRow key={person.id}>
                  <TableCell>
                    <Link
                      href={`/training/transcripts/${person.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {person.lastName}, {person.firstName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                    {person.employeeNo ?? '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <Badge variant="secondary">{records}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <Badge variant="outline">{assessments}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <Badge variant="outline">{skills}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/training/transcripts"
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
