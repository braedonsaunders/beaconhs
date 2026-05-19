import Link from 'next/link'
import { Award } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import {
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
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'

export const metadata = { title: 'Skills' }

const SORTS = ['name', 'authority', 'code', 'holders'] as const

export default async function TrainingSkillsPage({
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
  const authorityFilter = pickString(sp.authority)
  const ctx = await requireRequestContext()

  const { rows, total, authorities } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(trainingSkillTypes.name, term),
        ilike(trainingSkillTypes.code, term),
      )
      if (cond) filters.push(cond)
    }
    if (authorityFilter) filters.push(eq(trainingSkillTypes.authorityId, authorityFilter))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'authority'
        ? [
            params.dir === 'asc'
              ? asc(trainingSkillAuthorities.name)
              : desc(trainingSkillAuthorities.name),
          ]
        : params.sort === 'code'
          ? [
              params.dir === 'asc'
                ? asc(trainingSkillTypes.code)
                : desc(trainingSkillTypes.code),
            ]
          : params.sort === 'holders'
            ? [
                params.dir === 'asc'
                  ? asc(sql`count(${trainingSkillAssignments.id})`)
                  : desc(sql`count(${trainingSkillAssignments.id})`),
              ]
            : [
                params.dir === 'asc'
                  ? asc(trainingSkillTypes.name)
                  : desc(trainingSkillTypes.name),
              ]

    const [tot] = await tx.select({ c: count() }).from(trainingSkillTypes).where(whereClause)

    const data = await tx
      .select({
        type: trainingSkillTypes,
        authority: trainingSkillAuthorities,
        holders: sql<number>`count(${trainingSkillAssignments.id})`.mapWith(Number),
      })
      .from(trainingSkillTypes)
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .leftJoin(
        trainingSkillAssignments,
        eq(trainingSkillAssignments.skillTypeId, trainingSkillTypes.id),
      )
      .where(whereClause)
      .groupBy(trainingSkillTypes.id, trainingSkillAuthorities.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const auths = await tx
      .select({ id: trainingSkillAuthorities.id, name: trainingSkillAuthorities.name })
      .from(trainingSkillAuthorities)
      .orderBy(asc(trainingSkillAuthorities.name))

    return { rows: data, total: Number(tot?.c ?? 0), authorities: auths }
  })

  const sortProps = { basePath: '/training/skills', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Skills"
            description="Externally-issued competencies tracked per worker. Manage skill types under their authority."
            actions={
              <Link
                href="/training/authorities"
                className="text-sm text-teal-700 hover:underline"
              >
                Manage authorities →
              </Link>
            }
          />
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href="/training"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Records
            </Link>
            <Link
              href="/training/courses"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Courses
            </Link>
            <Link
              href="/training/authorities"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Skill authorities
            </Link>
            <Link
              href="/training/skills"
              className="rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700"
            >
              Skill types
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search by skill name or code" />
          </div>
          {authorities.length > 0 ? (
            <FilterChips
              basePath="/training/skills"
              currentParams={sp}
              paramKey="authority"
              label="Authority"
              options={authorities.map((a) => ({ value: a.id, label: a.name }))}
            />
          ) : null}
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Award size={32} />}
          title={params.q ? `No skills match "${params.q}"` : 'No skill types yet'}
          description="Create an authority first, then add the skills it issues."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Name
                </SortableTh>
                <SortableTh {...sortProps} column="authority" active={params.sort === 'authority'}>
                  Authority
                </SortableTh>
                <SortableTh {...sortProps} column="code" active={params.sort === 'code'}>
                  Code
                </SortableTh>
                <TableHead>Valid for</TableHead>
                <SortableTh {...sortProps} column="holders" active={params.sort === 'holders'}>
                  Holders
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ type, authority, holders }) => (
                <TableRow key={type.id}>
                  <TableCell>
                    <Link
                      href={`/training/skills/${type.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {type.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    <Link
                      href={`/training/authorities/${authority.id}`}
                      className="hover:underline"
                    >
                      {authority.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600">
                    {type.code ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {type.validForMonths ? `${type.validForMonths} months` : 'No expiry'}
                  </TableCell>
                  <TableCell className="text-slate-600 tabular-nums">{holders}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/training/skills"
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
