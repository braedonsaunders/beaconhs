import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { Award, ListChecks } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import {
  trainingExtraFields,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import {
  isUuid,
  mergeHref,
  parseListParams,
  parsePrefixedListParams,
  pickString,
} from '@/lib/list-params'
import { DetailPageLayout } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ActivityFeed } from '@/components/activity-feed'
import { ExtraFieldsSection } from '../../_components/extra-fields-section'
import { addExtraField, deleteExtraField } from '../../_lib/extra-fields-actions'
import { loadTrainingExtraFieldPage } from '../../_lib/extra-field-query'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'skill_types', 'extras', 'activity'] as const
type Tab = (typeof TABS)[number]
const SORTS = ['name'] as const
const EXTRA_SORTS = ['order'] as const

async function addSkillType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const authorityId = String(formData.get('authorityId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const code = String(formData.get('code') ?? '').trim() || null
  const validForMonthsRaw = String(formData.get('validForMonths') ?? '').trim()
  const validForMonths = validForMonthsRaw ? Number(validForMonthsRaw) : null
  const description = String(formData.get('description') ?? '').trim() || null

  await ctx.db((tx) =>
    tx.insert(trainingSkillTypes).values({
      tenantId: ctx.tenantId,
      authorityId,
      name,
      code,
      validForMonths,
      description,
    }),
  )
  await recordAudit(ctx, {
    entityType: 'training_skill_authority',
    entityId: authorityId,
    action: 'update',
    summary: `Added skill type "${name}"`,
  })
  revalidatePath(`/training/authorities/${authorityId}`)
  revalidatePath('/training/skills')
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_00c7420916983d', { value0: id.slice(0, 8) }) }
}

export default async function AuthorityDetailPage({
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
    sort: 'name',
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

  const ctx = await requireModuleManage('training')
  const data = await ctx.db(async (tx) => {
    const [authority] = await tx
      .select()
      .from(trainingSkillAuthorities)
      .where(eq(trainingSkillAuthorities.id, id))
      .limit(1)
    if (!authority) return null
    const search: SQL<unknown> | undefined = listParams.q
      ? or(
          ilike(trainingSkillTypes.name, `%${listParams.q}%`),
          ilike(trainingSkillTypes.code, `%${listParams.q}%`),
          ilike(trainingSkillTypes.description, `%${listParams.q}%`),
        )
      : undefined
    const typeWhere = and(eq(trainingSkillTypes.authorityId, id), search)
    const [[allTypeCount], [filteredTypeCount]] = await Promise.all([
      tx
        .select({ c: count() })
        .from(trainingSkillTypes)
        .where(eq(trainingSkillTypes.authorityId, id)),
      tx.select({ c: count() }).from(trainingSkillTypes).where(typeWhere),
    ])
    const skillTypes = await tx
      .select({
        type: trainingSkillTypes,
        holderCount: sql<number>`count(${trainingSkillAssignments.id})`.mapWith(Number),
      })
      .from(trainingSkillTypes)
      .leftJoin(
        trainingSkillAssignments,
        eq(trainingSkillAssignments.skillTypeId, trainingSkillTypes.id),
      )
      .where(typeWhere)
      .groupBy(trainingSkillTypes.id)
      .orderBy(asc(trainingSkillTypes.name))
      .limit(listParams.perPage)
      .offset((listParams.page - 1) * listParams.perPage)
    const extras = await loadTrainingExtraFieldPage(
      tx,
      eq(trainingExtraFields.authorityId, id),
      extraListParams,
    )
    return {
      authority,
      skillTypes,
      skillTypeCount: Number(allTypeCount?.c ?? 0),
      filteredSkillTypeCount: Number(filteredTypeCount?.c ?? 0),
      extras,
    }
  })

  if (!data) notFound()
  const { authority, skillTypes, skillTypeCount, filteredSkillTypeCount, extras } = data
  const activity =
    active === 'activity'
      ? await recentActivityForEntity(ctx, 'training_skill_authority', id, 50)
      : []

  const basePath = `/training/authorities/${id}`
  const drawer = pickString(sp.drawer)
  const closeHref = mergeHref(basePath, sp, { drawer: undefined })

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/authorities', label: 'Back to authorities' }}
          title={tGeneratedValue(authority.name)}
          subtitle={tGeneratedValue(
            [authority.code, authority.jurisdiction].filter(Boolean).join(' · ') || undefined,
          )}
          badge={
            authority.code ? (
              <Badge variant="secondary">
                <GeneratedValue value={authority.code} />
              </Badge>
            ) : undefined
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
            { key: 'skill_types', label: 'Skill types', count: skillTypeCount },
            { key: 'extras', label: 'Additional fields', count: extras.total },
            { key: 'activity', label: 'Activity' },
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
                  <GeneratedText id="m_011de566fc07f1" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DetailGrid
                  rows={[
                    { label: 'Name', value: authority.name },
                    { label: 'Code', value: authority.code ?? '—' },
                    { label: 'Jurisdiction', value: authority.jurisdiction ?? '—' },
                    { label: 'Skill types', value: skillTypeCount },
                    {
                      label: 'Created',
                      value: formatDateTime(
                        new Date(authority.createdAt),
                        ctx.timezone,
                        ctx.locale,
                      ),
                    },
                  ]}
                />
                <GeneratedValue
                  value={
                    authority.notes ? (
                      <div className="mt-4">
                        <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                          <GeneratedText id="m_0b8dadcb78cd08" />
                        </div>
                        <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                          <GeneratedValue value={authority.notes} />
                        </p>
                      </div>
                    ) : null
                  }
                />
              </CardContent>
            </Card>
          ) : null
        }
      />

      <GeneratedValue
        value={
          active === 'skill_types' ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_1794a721de25db" />
                    <GeneratedValue
                      value={
                        filteredSkillTypeCount === skillTypeCount ? (
                          skillTypeCount
                        ) : (
                          <GeneratedText
                            id="m_098d2de6c8b983"
                            values={{ value0: filteredSkillTypeCount, value1: skillTypeCount }}
                          />
                        )
                      }
                    />
                    )
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <TableToolbar className="mb-3">
                    <SearchInput placeholder={tGenerated('m_060988b0586aec')} />
                  </TableToolbar>
                  <GeneratedValue
                    value={
                      skillTypes.length === 0 ? (
                        <EmptyState
                          icon={<Award size={24} />}
                          title={tGeneratedValue(
                            listParams.q
                              ? tGenerated('m_061285ff322013')
                              : tGenerated('m_0577337dc146c0'),
                          )}
                          description={tGeneratedValue(
                            listParams.q
                              ? tGenerated('m_127baaef2d36ae')
                              : tGenerated('m_08d77171166ab3'),
                          )}
                        />
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                <GeneratedText id="m_02b18d5c7f6f2d" />
                              </TableHead>
                              <TableHead>
                                <GeneratedText id="m_0570e24c85cf95" />
                              </TableHead>
                              <TableHead>
                                <GeneratedText id="m_10df4bba8fe3ad" />
                              </TableHead>
                              <TableHead>
                                <GeneratedText id="m_196b2418a9876a" />
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <GeneratedValue
                              value={skillTypes.map(({ type, holderCount }) => (
                                <TableRow key={type.id}>
                                  <TableCell>
                                    <Link
                                      href={`/training/skills/types/${type.id}`}
                                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                                    >
                                      <GeneratedValue value={type.name} />
                                    </Link>
                                  </TableCell>
                                  <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                                    <GeneratedValue value={type.code ?? '—'} />
                                  </TableCell>
                                  <TableCell className="text-slate-600 dark:text-slate-400">
                                    <GeneratedValue
                                      value={
                                        type.validForMonths ? (
                                          <GeneratedText
                                            id="m_1fa77753c09829"
                                            values={{ value0: type.validForMonths }}
                                          />
                                        ) : (
                                          <GeneratedText id="m_1bbc44c1ce26a7" />
                                        )
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="text-slate-600 tabular-nums dark:text-slate-400">
                                    <GeneratedValue value={holderCount} />
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
                    total={filteredSkillTypeCount}
                    page={listParams.page}
                    perPage={listParams.perPage}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_0af680c2c0e3dd" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={addSkillType} className="space-y-3">
                    <input type="hidden" name="authorityId" value={id} />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label>
                          <GeneratedText id="m_02b18d5c7f6f2d" />{' '}
                          <span className="text-red-600 dark:text-red-400">*</span>
                        </Label>
                        <Input name="name" required placeholder={tGenerated('m_1718ebed63ad83')} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>
                          <GeneratedText id="m_0570e24c85cf95" />
                        </Label>
                        <Input name="code" placeholder={tGenerated('m_07d838807d109b')} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>
                          <GeneratedText id="m_0e5ba68fcd28f2" />
                        </Label>
                        <Input
                          name="validForMonths"
                          type="number"
                          min={1}
                          placeholder={tGenerated('m_056a47a6cd2d44')}
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-3">
                        <Label>
                          <GeneratedText id="m_14d923495cf14c" />
                        </Label>
                        <Textarea name="description" rows={2} />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit">
                        <ListChecks size={14} /> <GeneratedText id="m_0af680c2c0e3dd" />
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          active === 'extras' ? (
            <ExtraFieldsSection
              ownerType="authority"
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
          active === 'activity' ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <GeneratedText id="m_14b78af1b2f95e" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
              </CardContent>
            </Card>
          ) : null
        }
      />
    </DetailPageLayout>
  )
}
