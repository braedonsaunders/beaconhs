import { skillStanding } from '@beaconhs/compliance'
import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
  tenants,
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
import { SkillTypeFields } from './_fields'
import { deleteSkillType } from '../_actions'
import { ConfirmButton } from '@/components/confirm-button'
import { enabledCredentialOutputs } from '@/lib/credential-designs'
import { activePeopleWhere } from '@beaconhs/db'
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
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_02ba00984d4cb1', { value0: id.slice(0, 8) }) }
}

export default async function SkillTypeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
  const statusFilter = [
    'valid',
    'expiring',
    'expired',
    'no_expiry',
    'tested',
    'recommended',
    'failed',
    'draft',
  ].includes(statusParam ?? '')
    ? (statusParam as
        | 'valid'
        | 'expiring'
        | 'expired'
        | 'no_expiry'
        | 'tested'
        | 'recommended'
        | 'failed'
        | 'draft')
    : undefined
  const now = new Date()
  const todayIso = now.toISOString().slice(0, 10)
  const in90 = new Date(now)
  in90.setDate(in90.getDate() + 90)
  const in90Iso = in90.toISOString().slice(0, 10)

  const ctx = await requireModuleManage('training')
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ type: trainingSkillTypes, authority: trainingSkillAuthorities })
      .from(trainingSkillTypes)
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .where(and(eq(trainingSkillTypes.id, id), isNull(trainingSkillTypes.deletedAt)))
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
        ? or(
            eq(trainingSkillAssignments.status, 'expired'),
            and(
              eq(trainingSkillAssignments.status, 'complete'),
              lt(trainingSkillAssignments.expiresOn, todayIso),
            ),
          )
        : statusFilter === 'expiring'
          ? and(
              eq(trainingSkillAssignments.status, 'complete'),
              gte(trainingSkillAssignments.expiresOn, todayIso),
              lte(trainingSkillAssignments.expiresOn, in90Iso),
            )
          : statusFilter === 'valid'
            ? and(
                eq(trainingSkillAssignments.status, 'complete'),
                gt(trainingSkillAssignments.expiresOn, in90Iso),
              )
            : statusFilter === 'no_expiry'
              ? and(
                  eq(trainingSkillAssignments.status, 'complete'),
                  isNull(trainingSkillAssignments.expiresOn),
                )
              : statusFilter
                ? eq(
                    trainingSkillAssignments.status,
                    statusFilter as 'tested' | 'recommended' | 'failed' | 'draft',
                  )
                : undefined
    const baseWhere = and(
      eq(trainingSkillAssignments.skillTypeId, id),
      isNull(trainingSkillAssignments.deletedAt),
      activePeopleWhere(),
      sql`${trainingSkillAssignments.id} IN (SELECT id FROM report_skill_assignments)`,
    )
    const where = and(baseWhere, search, status)
    const [holderSummary] = await tx
      .select({
        total: count(),
        expired: sql<string>`count(*) filter (where ${trainingSkillAssignments.status} = 'expired' or (${trainingSkillAssignments.status} = 'complete' and ${trainingSkillAssignments.expiresOn} < ${todayIso}))`,
        expiring: sql<string>`count(*) filter (where ${trainingSkillAssignments.status} = 'complete' and ${trainingSkillAssignments.expiresOn} >= ${todayIso} and ${trainingSkillAssignments.expiresOn} <= ${in90Iso})`,
      })
      .from(trainingSkillAssignments)
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))
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
      .orderBy(
        sql`CASE WHEN ${trainingSkillAssignments.status} = 'complete' AND (${trainingSkillAssignments.expiresOn} IS NULL OR ${trainingSkillAssignments.expiresOn} >= ${todayIso}) THEN 0 ELSE 1 END`,
        asc(trainingSkillAssignments.expiresOn),
      )
      .limit(listParams.perPage)
      .offset((listParams.page - 1) * listParams.perPage)
    const extras = await loadTrainingExtraFieldPage(
      tx,
      eq(trainingExtraFields.skillTypeId, id),
      extraListParams,
    )
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    return {
      outputs: enabledCredentialOutputs(tenant?.settings),
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

  const holdersWithStatus = holders.map((h) => {
    const daysLeft = h.assignment.expiresOn
      ? Math.round(
          (new Date(h.assignment.expiresOn).getTime() - new Date(todayIso).getTime()) / 86_400_000,
        )
      : null
    const standing = skillStanding(h.assignment, todayIso)
    const status = standing === 'valid' && !h.assignment.expiresOn ? 'no_expiry' : standing
    return { ...h, daysLeft, status }
  })

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/skills/types', label: 'Back to skills' }}
          title={tGeneratedValue(type.name)}
          subtitle={tGeneratedValue(`${authority.name}${type.code ? ` · ${type.code}` : ''}`)}
          badge={
            type.validForMonths ? (
              <Badge variant="secondary">
                <GeneratedValue value={type.validForMonths} />{' '}
                <GeneratedText id="m_1dcd4db85ef759" />
              </Badge>
            ) : (
              <Badge variant="secondary">
                <GeneratedText id="m_1bbc44c1ce26a7" />
              </Badge>
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
      <GeneratedValue
        value={
          active === 'overview' ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <GeneratedText id="m_0726401650a205" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SkillTypeFields type={type} outputs={data.outputs} />
                <form action={deleteSkillType} className="mt-6">
                  <input type="hidden" name="id" value={id} />
                  <ConfirmButton variant="destructive" message={tGenerated('m_14c2bcbba0cca1')}>
                    <GeneratedText id="m_17f7f669e3ac1d" />
                  </ConfirmButton>
                </form>
              </CardContent>
            </Card>
          ) : null
        }
      />

      <GeneratedValue
        value={
          active === 'extras' ? (
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
          ) : null
        }
      />

      <GeneratedValue
        value={
          active === 'holders' ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <GeneratedText id="m_01c5d8b420ab26" />
                  <GeneratedValue value={holderCount} />)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TableToolbar className="mb-3">
                  <SearchInput placeholder={tGenerated('m_0d62e60074ccc5')} />
                  <FilterChips
                    basePath={basePath}
                    currentParams={sp}
                    paramKey="status"
                    label={tGenerated('m_0b9da892d6faf0')}
                    options={[
                      { value: 'valid', label: 'Valid' },
                      { value: 'expiring', label: 'Expiring' },
                      { value: 'expired', label: 'Expired' },
                      { value: 'no_expiry', label: 'No expiry' },
                    ]}
                  />
                </TableToolbar>
                <GeneratedValue
                  value={
                    holdersWithStatus.length === 0 ? (
                      <EmptyState
                        icon={<Users size={24} />}
                        title={tGeneratedValue(
                          listParams.q || statusFilter
                            ? tGenerated('m_01608e35e0187e')
                            : tGenerated('m_0a489925873a79'),
                        )}
                        description={tGeneratedValue(
                          listParams.q || statusFilter
                            ? tGenerated('m_10d3a4d20620cd')
                            : tGenerated('m_0bd00e130fe9bf'),
                        )}
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <GeneratedText id="m_12e926c9216094" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_10633978809d91" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_14f3858b0a9ad6" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_0b9da892d6faf0" />
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <GeneratedValue
                            value={holdersWithStatus.map((h) => (
                              <TableRow key={h.assignment.id}>
                                <TableCell>
                                  <Link
                                    href={`/people/${h.person.id}`}
                                    className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                                  >
                                    <GeneratedValue value={h.person.lastName} />,{' '}
                                    <GeneratedValue value={h.person.firstName} />
                                  </Link>
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-400">
                                  <GeneratedValue value={h.assignment.grantedOn} />
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-400">
                                  <GeneratedValue value={h.assignment.expiresOn ?? '—'} />
                                </TableCell>
                                <TableCell>
                                  <GeneratedValue
                                    value={
                                      h.status === 'missing' ? (
                                        <Badge variant="secondary">{h.assignment.status}</Badge>
                                      ) : h.status === 'expired' ? (
                                        <Badge variant="destructive">
                                          <GeneratedText id="m_13f7150c94b182" />{' '}
                                          {Math.abs(h.daysLeft!)}
                                          <GeneratedText id="m_0ced4968a01894" />
                                        </Badge>
                                      ) : h.status === 'expiring' ? (
                                        <Badge variant="warning">
                                          {h.daysLeft}
                                          <GeneratedText id="m_0a3d63460246cf" />
                                        </Badge>
                                      ) : h.status === 'valid' ? (
                                        <Badge variant="success">
                                          <GeneratedText id="m_1e418d0475450c" />
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary">
                                          <GeneratedText id="m_1bbc44c1ce26a7" />
                                        </Badge>
                                      )
                                    }
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          />
                        </TableBody>
                      </Table>
                    )
                  }
                />
                <Pagination
                  basePath={basePath}
                  currentParams={sp}
                  total={filteredHolderCount}
                  page={listParams.page}
                  perPage={listParams.perPage}
                />
              </CardContent>
            </Card>
          ) : null
        }
      />
    </DetailPageLayout>
  )
}
