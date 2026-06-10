// Skills — the operational list of externally-issued skills & certifications
// held by people (training_skill_assignments × skill type × authority).
// Course-completion certificates live under /training/records ("Certificates");
// this list is the OTHER credential path. The skill-type catalogue is admin
// config at /training/skills/types.

import Link from 'next/link'
import { Star } from 'lucide-react'
import { and, asc, count, desc, eq, gt, ilike, isNotNull, isNull, lte, or, type SQL } from 'drizzle-orm'
import { Badge, EmptyState, PageHeader } from '@beaconhs/ui'
import {
  people,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SortableTh } from '@/components/sortable-th'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@beaconhs/ui'
import { TrainingSubNav } from '../_components/training-sub-nav'

export const metadata = { title: 'Skills' }
export const dynamic = 'force-dynamic'

const SORTS = ['person', 'skill', 'authority', 'granted_on', 'expires_on'] as const

const STATUS_OPTIONS = [
  { value: 'valid', label: 'Valid' },
  { value: 'expiring', label: 'Expiring (90d)' },
  { value: 'expired', label: 'Expired' },
]

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'expires_on',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const authorityFilter = pickString(sp.authority)
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)
  const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)

  const { rows, total, authorities } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(people.firstName, term),
        ilike(people.lastName, term),
        ilike(people.employeeNo, term),
        ilike(trainingSkillTypes.name, term),
        ilike(trainingSkillTypes.code, term),
        ilike(trainingSkillAuthorities.name, term),
      )
      if (cond) filters.push(cond)
    }
    if (authorityFilter) filters.push(eq(trainingSkillAuthorities.id, authorityFilter))
    if (statusFilter === 'expired') {
      filters.push(isNotNull(trainingSkillAssignments.expiresOn))
      filters.push(lte(trainingSkillAssignments.expiresOn, today))
    } else if (statusFilter === 'expiring') {
      filters.push(isNotNull(trainingSkillAssignments.expiresOn))
      filters.push(gt(trainingSkillAssignments.expiresOn, today))
      filters.push(lte(trainingSkillAssignments.expiresOn, in90))
    } else if (statusFilter === 'valid') {
      const c = or(
        isNull(trainingSkillAssignments.expiresOn),
        gt(trainingSkillAssignments.expiresOn, today),
      )
      if (c) filters.push(c)
    }
    const whereClause = filters.length ? and(...filters) : undefined

    const orderBy =
      params.sort === 'person'
        ? params.dir === 'asc'
          ? [asc(people.lastName), asc(people.firstName)]
          : [desc(people.lastName), desc(people.firstName)]
        : params.sort === 'skill'
          ? [params.dir === 'asc' ? asc(trainingSkillTypes.name) : desc(trainingSkillTypes.name)]
          : params.sort === 'authority'
            ? [
                params.dir === 'asc'
                  ? asc(trainingSkillAuthorities.name)
                  : desc(trainingSkillAuthorities.name),
              ]
            : params.sort === 'granted_on'
              ? [
                  params.dir === 'asc'
                    ? asc(trainingSkillAssignments.grantedOn)
                    : desc(trainingSkillAssignments.grantedOn),
                ]
              : [
                  params.dir === 'asc'
                    ? asc(trainingSkillAssignments.expiresOn)
                    : desc(trainingSkillAssignments.expiresOn),
                ]

    const base = tx
      .select({
        assignment: trainingSkillAssignments,
        type: trainingSkillTypes,
        authority: trainingSkillAuthorities,
        person: people,
      })
      .from(trainingSkillAssignments)
      .innerJoin(trainingSkillTypes, eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId))
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))

    const [tot] = await tx
      .select({ c: count() })
      .from(trainingSkillAssignments)
      .innerJoin(trainingSkillTypes, eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId))
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))
      .where(whereClause)

    const data = await base
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const auths = await tx
      .select({ id: trainingSkillAuthorities.id, name: trainingSkillAuthorities.name })
      .from(trainingSkillAuthorities)
      .orderBy(asc(trainingSkillAuthorities.name))

    return { rows: data, total: Number(tot?.c ?? 0), authorities: auths }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Skills"
            description="Externally-issued skills and certifications held across the workforce — granted by authorities, with expiry tracking."
          />
          <TrainingSubNav active="skills" />
          <TableToolbar>
            <SearchInput placeholder="Search person, skill, code, authority…" />
            <FilterChips
              basePath="/training/skills"
              currentParams={sp}
              paramKey="authority"
              label="Authority"
              options={authorities.map((a) => ({ value: a.id, label: a.name }))}
            />
            <FilterChips
              basePath="/training/skills"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Star size={32} />}
          title={
            params.q || statusFilter || authorityFilter
              ? 'No skills match these filters'
              : 'No skills recorded yet'
          }
          description="Grant skills from a person's transcript, or manage the catalogue under Manage → Skill types."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTh basePath="/training/skills" currentParams={sp} column="person" active={params.sort === 'person'} dir={params.dir}>
                    Person
                  </SortableTh>
                  <SortableTh basePath="/training/skills" currentParams={sp} column="skill" active={params.sort === 'skill'} dir={params.dir}>
                    Skill / certification
                  </SortableTh>
                  <SortableTh basePath="/training/skills" currentParams={sp} column="authority" active={params.sort === 'authority'} dir={params.dir}>
                    Authority
                  </SortableTh>
                  <SortableTh basePath="/training/skills" currentParams={sp} column="granted_on" active={params.sort === 'granted_on'} dir={params.dir}>
                    Granted
                  </SortableTh>
                  <SortableTh basePath="/training/skills" currentParams={sp} column="expires_on" active={params.sort === 'expires_on'} dir={params.dir}>
                    Expires
                  </SortableTh>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ assignment, type, authority, person }) => {
                  const exp = assignment.expiresOn
                  const days = exp
                    ? Math.round((new Date(exp).getTime() - Date.now()) / 86_400_000)
                    : null
                  return (
                    <TableRow key={assignment.id}>
                      <TableCell>
                        <Link
                          href={`/training/transcripts/${person.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {person.lastName}, {person.firstName}
                        </Link>
                        {person.employeeNo ? (
                          <div className="text-xs text-slate-500">#{person.employeeNo}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/training/skills/types/${type.id}`}
                          className="text-slate-700 hover:underline"
                        >
                          {type.code ? <span className="font-mono text-xs">{type.code}</span> : null}
                          {type.code ? ' · ' : ''}
                          {type.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600">{authority.name}</TableCell>
                      <TableCell className="tabular-nums text-slate-600">
                        {assignment.grantedOn}
                      </TableCell>
                      <TableCell className="tabular-nums text-slate-600">
                        {exp ?? <span className="text-slate-400">Never</span>}
                      </TableCell>
                      <TableCell>
                        {days === null ? (
                          <Badge variant="secondary">No expiry</Badge>
                        ) : days < 0 ? (
                          <Badge variant="destructive">Expired</Badge>
                        ) : days <= 90 ? (
                          <Badge variant="warning">{days}d left</Badge>
                        ) : (
                          <Badge variant="success">Valid</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
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
