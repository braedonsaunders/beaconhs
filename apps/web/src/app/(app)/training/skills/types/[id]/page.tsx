import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  ilike,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { Users } from 'lucide-react'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  people,
  trainingExtraFields,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import {
  isUuid,
  mergeHref,
  parseListParams,
  parsePrefixedListParams,
  pickString,
} from '@/lib/list-params'
import { DetailPageLayout } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ExtraFieldsSection } from '../../../_components/extra-fields-section'
import { addExtraField, deleteExtraField } from '../../../_lib/extra-fields-actions'
import { loadTrainingExtraFieldPage } from '../../../_lib/extra-field-query'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'holders', 'extras'] as const
type Tab = (typeof TABS)[number]
const SORTS = ['expiry'] as const
const EXTRA_SORTS = ['order'] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Skill · ${id.slice(0, 8)}` }
}

export default async function SkillTypeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')
  const listParams = parseListParams(sp, {
    sort: 'expiry',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const extraListParams = parsePrefixedListParams(sp, 'extra', {
    sort: 'order',
    dir: 'asc',
    perPage: 25,
    allowedSorts: EXTRA_SORTS,
  })
  const statusParam = pickString(sp.status)
  const statusFilter = ['valid', 'expiring', 'expired', 'no_expiry'].includes(statusParam ?? '')
    ? (statusParam as 'valid' | 'expiring' | 'expired' | 'no_expiry')
    : undefined
  const now = new Date()
  const todayIso = now.toISOString().slice(0, 10)
  const in30 = new Date(now)
  in30.setDate(in30.getDate() + 30)
  const in30Iso = in30.toISOString().slice(0, 10)

  const ctx = await requireModuleManage('training')
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ type: trainingSkillTypes, authority: trainingSkillAuthorities })
      .from(trainingSkillTypes)
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .where(eq(trainingSkillTypes.id, id))
      .limit(1)
    if (!row) return null
    const search: SQL<unknown> | undefined = listParams.q
      ? or(
          ilike(people.firstName, `%${listParams.q}%`),
          ilike(people.lastName, `%${listParams.q}%`),
          ilike(people.employeeNo, `%${listParams.q}%`),
        )
      : undefined
    const status =
      statusFilter === 'expired'
        ? lt(trainingSkillAssignments.expiresOn, todayIso)
        : statusFilter === 'expiring'
          ? and(
              gte(trainingSkillAssignments.expiresOn, todayIso),
              lte(trainingSkillAssignments.expiresOn, in30Iso),
            )
          : statusFilter === 'valid'
            ? gt(trainingSkillAssignments.expiresOn, in30Iso)
            : statusFilter === 'no_expiry'
              ? isNull(trainingSkillAssignments.expiresOn)
              : undefined
    const baseWhere = and(
      eq(trainingSkillAssignments.skillTypeId, id),
      isNull(trainingSkillAssignments.deletedAt),
    )
    const where = and(baseWhere, search, status)
    const [holderSummary] = await tx
      .select({
        total: count(),
        expired: sql<string>`count(*) filter (where ${trainingSkillAssignments.expiresOn} < ${todayIso})`,
        expiring: sql<string>`count(*) filter (where ${trainingSkillAssignments.expiresOn} >= ${todayIso} and ${trainingSkillAssignments.expiresOn} <= ${in30Iso})`,
      })
      .from(trainingSkillAssignments)
      .where(baseWhere)
    const [filteredCount] = await tx
      .select({ c: count() })
      .from(trainingSkillAssignments)
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))
      .where(where)
    const holders = await tx
      .select({ assignment: trainingSkillAssignments, person: people })
      .from(trainingSkillAssignments)
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))
      .where(where)
      .orderBy(asc(trainingSkillAssignments.expiresOn))
      .limit(listParams.perPage)
      .offset((listParams.page - 1) * listParams.perPage)
    const extras = await loadTrainingExtraFieldPage(
      tx,
      eq(trainingExtraFields.skillTypeId, id),
      extraListParams,
    )
    return {
      ...row,
      holders,
      holderCount: Number(holderSummary?.total ?? 0),
      expiredCount: Number(holderSummary?.expired ?? 0),
      expiringCount: Number(holderSummary?.expiring ?? 0),
      filteredHolderCount: Number(filteredCount?.c ?? 0),
      extras,
    }
  })

  if (!data) notFound()
  const {
    type,
    authority,
    holders,
    holderCount,
    expiredCount,
    expiringCount,
    filteredHolderCount,
    extras,
  } = data
  const drawer = pickString(sp.drawer)
  const basePath = `/training/skills/types/${id}`
  const closeHref = mergeHref(basePath, sp, { drawer: undefined })

  const today = now
  const holdersWithStatus = holders.map((h) => {
    const exp = h.assignment.expiresOn ? new Date(h.assignment.expiresOn) : null
    const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
    const status: 'valid' | 'expiring' | 'expired' | 'no_expiry' =
      daysLeft === null
        ? 'no_expiry'
        : daysLeft < 0
          ? 'expired'
          : daysLeft <= 30
            ? 'expiring'
            : 'valid'
    return { ...h, daysLeft, status }
  })

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/skills/types', label: 'Back to skills' }}
          title={type.name}
          subtitle={`${authority.name}${type.code ? ` · ${type.code}` : ''}`}
          badge={
            type.validForMonths ? (
              <Badge variant="secondary">{type.validForMonths} months</Badge>
            ) : (
              <Badge variant="secondary">No expiry</Badge>
            )
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'holders', label: 'Holders', count: holderCount },
            { key: 'extras', label: 'Additional fields', count: extras.total },
          ]}
        />
      }
    >
      {active === 'overview' ? (
        <Card>
          <CardHeader>
            <CardTitle>Skill details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid
              rows={[
                { label: 'Name', value: type.name },
                {
                  label: 'Authority',
                  value: (
                    <Link
                      href={`/training/authorities/${authority.id}`}
                      className="text-teal-700 hover:underline dark:text-teal-400"
                    >
                      {authority.name}
                    </Link>
                  ),
                },
                { label: 'Code', value: type.code ?? '—' },
                {
                  label: 'Valid for',
                  value: type.validForMonths ? `${type.validForMonths} months` : 'No expiry',
                },
                { label: 'Holders', value: holderCount },
                {
                  label: 'Expiring (30d)',
                  value: expiringCount > 0 ? <Badge variant="warning">{expiringCount}</Badge> : '0',
                },
                {
                  label: 'Expired',
                  value:
                    expiredCount > 0 ? <Badge variant="destructive">{expiredCount}</Badge> : '0',
                },
              ]}
            />
            {type.description ? (
              <div className="mt-4">
                <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  Description
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                  {type.description}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {active === 'extras' ? (
        <ExtraFieldsSection
          ownerType="skill_type"
          ownerId={id}
          rows={extras.rows}
          list={{
            basePath,
            currentParams: sp,
            total: extras.total,
            filteredTotal: extras.filteredTotal,
            query: extraListParams.q,
            page: extraListParams.page,
            perPage: extraListParams.perPage,
            queryParamKey: 'extraQ',
            pageParamKey: 'extraPage',
          }}
          drawerOpen={drawer === 'add-extra-field'}
          drawerCloseHref={closeHref}
          addHref={mergeHref(basePath, sp, { tab: 'extras', drawer: 'add-extra-field' })}
          addAction={addExtraField}
          deleteAction={deleteExtraField}
        />
      ) : null}

      {active === 'holders' ? (
        <Card>
          <CardHeader>
            <CardTitle>Holders ({holderCount})</CardTitle>
          </CardHeader>
          <CardContent>
            <TableToolbar className="mb-3">
              <SearchInput placeholder="Search person or employee number…" />
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="status"
                label="Status"
                options={[
                  { value: 'valid', label: 'Valid' },
                  { value: 'expiring', label: 'Expiring' },
                  { value: 'expired', label: 'Expired' },
                  { value: 'no_expiry', label: 'No expiry' },
                ]}
              />
            </TableToolbar>
            {holdersWithStatus.length === 0 ? (
              <EmptyState
                icon={<Users size={24} />}
                title={
                  listParams.q || statusFilter ? 'No holders match your filters' : 'No holders'
                }
                description={
                  listParams.q || statusFilter
                    ? 'Clear the search or status filter to see other holders.'
                    : 'Assign this skill to a person from their profile.'
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Granted</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdersWithStatus.map((h) => (
                    <TableRow key={h.assignment.id}>
                      <TableCell>
                        <Link
                          href={`/people/${h.person.id}`}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {h.person.lastName}, {h.person.firstName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {h.assignment.grantedOn}
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {h.assignment.expiresOn ?? '—'}
                      </TableCell>
                      <TableCell>
                        {h.status === 'expired' ? (
                          <Badge variant="destructive">Expired {Math.abs(h.daysLeft!)}d ago</Badge>
                        ) : h.status === 'expiring' ? (
                          <Badge variant="warning">{h.daysLeft}d left</Badge>
                        ) : h.status === 'valid' ? (
                          <Badge variant="success">Valid</Badge>
                        ) : (
                          <Badge variant="secondary">No expiry</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Pagination
              basePath={basePath}
              currentParams={sp}
              total={filteredHolderCount}
              page={listParams.page}
              perPage={listParams.perPage}
            />
          </CardContent>
        </Card>
      ) : null}
    </DetailPageLayout>
  )
}
