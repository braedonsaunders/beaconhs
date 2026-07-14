// Skills — the operational list of externally-issued skills & certifications
// held by people (training_skill_assignments × skill type × authority).
// Course-completion certificates live under /training/records ("Certificates");
// this list is the OTHER credential path. The skill-type catalogue is admin
// config at /training/skills/types.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText, Star } from 'lucide-react'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
} from 'drizzle-orm'
import { Badge, Button, EmptyState, PageHeader } from '@beaconhs/ui'
import {
  people,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { moduleScopeWhere } from '@/lib/visibility'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SearchFilter } from '@/components/search-filter'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SortableTh } from '@/components/sortable-th'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@beaconhs/ui'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { startSkillAssignment } from './_actions'

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
  const personFilter = pickString(sp.person)
  const skillFilter = pickString(sp.skill)
  const ctx = await requireRequestContext()
  const canManage = canManageModule(ctx, 'training')
  // Skills are person-scoped credentials: viewing the list requires a training
  // read tier (mirrors /training/records). Managers see everything — they edit
  // any assignment; read.self holders are scoped to their own rows below. No
  // qualifying permission at all → 404.
  if (
    !ctx.isSuperAdmin &&
    !canManage &&
    !can(ctx, 'training.read.all') &&
    !can(ctx, 'training.read.self')
  )
    notFound()
  const now = new Date()
  const nowMs = now.getTime()
  const today = now.toISOString().slice(0, 10)
  const in90 = new Date(nowMs + 90 * 86_400_000).toISOString().slice(0, 10)

  const { rows, total, authorities, peopleList, skillTypesList } = await ctx.db(async (tx) => {
    // read.self → only the viewer's own skills; managers/read.all → everyone.
    const vis = canManage
      ? undefined
      : await moduleScopeWhere(ctx, tx, {
          prefix: 'training',
          personCol: trainingSkillAssignments.personId,
        })
    const filters: SQL<unknown>[] = [isNull(trainingSkillAssignments.deletedAt)]
    if (vis) filters.push(vis)
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
    if (personFilter) filters.push(eq(trainingSkillAssignments.personId, personFilter))
    if (skillFilter) filters.push(eq(trainingSkillTypes.id, skillFilter))
    // Defaults to "valid" when no status param is present; the "All" chip
    // navigates to an explicit `all` sentinel to show every skill.
    const effectiveStatus = statusFilter ?? 'valid'
    if (effectiveStatus === 'expired') {
      filters.push(isNotNull(trainingSkillAssignments.expiresOn))
      filters.push(lte(trainingSkillAssignments.expiresOn, today))
    } else if (effectiveStatus === 'expiring') {
      filters.push(isNotNull(trainingSkillAssignments.expiresOn))
      filters.push(gt(trainingSkillAssignments.expiresOn, today))
      filters.push(lte(trainingSkillAssignments.expiresOn, in90))
    } else if (effectiveStatus === 'valid') {
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
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))

    const [tot] = await tx
      .select({ c: count() })
      .from(trainingSkillAssignments)
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
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

    // Filter option lists: only people/skill types that actually hold an
    // assignment (so the dropdowns aren't padded with never-credentialed
    // rows), scoped to the assignments the viewer can see.
    const peopleList = await tx
      .selectDistinct({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(trainingSkillAssignments)
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))
      .where(and(isNull(trainingSkillAssignments.deletedAt), vis))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const skillTypesList = await tx
      .selectDistinct({
        id: trainingSkillTypes.id,
        name: trainingSkillTypes.name,
        code: trainingSkillTypes.code,
      })
      .from(trainingSkillAssignments)
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .where(and(isNull(trainingSkillAssignments.deletedAt), vis))
      .orderBy(asc(trainingSkillTypes.name))

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      authorities: auths,
      peopleList,
      skillTypesList,
    }
  })
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Skills"
            description="Skills and certifications across the workforce, with expiry tracking."
            actions={
              canManage ? (
                <form action={startSkillAssignment}>
                  <Button type="submit">New skill</Button>
                </form>
              ) : undefined
            }
          />
          <TrainingSubNav active="skills" />
          <TableToolbar>
            <SearchInput placeholder="Search person, skill, code, authority…" />
            {peopleList.length > 0 ? (
              <SearchFilter
                basePath="/training/skills"
                currentParams={sp}
                paramKey="person"
                placeholder="All people"
                searchPlaceholder="Search people…"
                options={peopleList.map((p) => ({
                  value: p.id,
                  label: `${p.lastName}, ${p.firstName}`,
                  hint: p.employeeNo ?? undefined,
                }))}
              />
            ) : null}
            {skillTypesList.length > 0 ? (
              <SearchFilter
                basePath="/training/skills"
                currentParams={sp}
                paramKey="skill"
                placeholder="All skills"
                searchPlaceholder="Search skills…"
                options={skillTypesList.map((t) => ({
                  value: t.id,
                  label: t.code ? `${t.code} · ${t.name}` : t.name,
                }))}
              />
            ) : null}
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
              defaultValue="valid"
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
            params.q || statusFilter || authorityFilter || personFilter || skillFilter
              ? 'No skills match these filters'
              : 'No skills recorded'
          }
          description="Add a skill with New skill, or manage the catalogue under Manage → Skill types."
          action={
            canManage ? (
              <form action={startSkillAssignment}>
                <Button type="submit">New skill</Button>
              </form>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTh
                    basePath="/training/skills"
                    currentParams={sp}
                    column="person"
                    active={params.sort === 'person'}
                    dir={params.dir}
                  >
                    Person
                  </SortableTh>
                  <SortableTh
                    basePath="/training/skills"
                    currentParams={sp}
                    column="skill"
                    active={params.sort === 'skill'}
                    dir={params.dir}
                  >
                    Skill / certification
                  </SortableTh>
                  <SortableTh
                    basePath="/training/skills"
                    currentParams={sp}
                    column="authority"
                    active={params.sort === 'authority'}
                    dir={params.dir}
                  >
                    Authority
                  </SortableTh>
                  <SortableTh
                    basePath="/training/skills"
                    currentParams={sp}
                    column="granted_on"
                    active={params.sort === 'granted_on'}
                    dir={params.dir}
                  >
                    Granted
                  </SortableTh>
                  <SortableTh
                    basePath="/training/skills"
                    currentParams={sp}
                    column="expires_on"
                    active={params.sort === 'expires_on'}
                    dir={params.dir}
                  >
                    Expires
                  </SortableTh>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Credentials</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ assignment, type, authority, person }) => {
                  const exp = assignment.expiresOn
                  const days = exp
                    ? Math.round((new Date(exp).getTime() - nowMs) / 86_400_000)
                    : null
                  return (
                    <TableRow key={assignment.id}>
                      <TableCell>
                        <Link
                          href={`/people/${person.id}?tab=skills`}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {person.lastName}, {person.firstName}
                        </Link>
                        {person.employeeNo ? (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            #{person.employeeNo}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/training/skills/${assignment.id}`}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {type.code ? (
                            <span className="font-mono text-xs">{type.code}</span>
                          ) : null}
                          {type.code ? ' · ' : ''}
                          {type.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {authority.name}
                      </TableCell>
                      <TableCell className="text-slate-600 tabular-nums dark:text-slate-400">
                        {assignment.grantedOn}
                      </TableCell>
                      <TableCell className="text-slate-600 tabular-nums dark:text-slate-400">
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
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/training/skills/${assignment.id}?tab=outputs`}>
                              <FileText size={15} /> View
                            </Link>
                          </Button>
                        </div>
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
