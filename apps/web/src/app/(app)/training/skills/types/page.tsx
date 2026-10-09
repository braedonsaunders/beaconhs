import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Award } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  EmptyState,
  Button,
  Input,
  Select,
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
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { createSkillType } from './_actions'
import { TrainingSubNav } from '../../_components/training-sub-nav'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a286702b9eafe') }
}

const SORTS = ['name', 'authority', 'code', 'holders'] as const

export default async function TrainingSkillsPage({
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
  const authorityFilter = pickString(sp.authority)
  const ctx = await requireModuleManage('training')

  const { rows, total, authorities } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(trainingSkillTypes.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(trainingSkillTypes.name, term), ilike(trainingSkillTypes.code, term))
      if (cond) filters.push(cond)
    }
    const state = pickString(sp.active)
    if (state === '1' || state === '0') filters.push(eq(trainingSkillTypes.isActive, state === '1'))
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
          ? [params.dir === 'asc' ? asc(trainingSkillTypes.code) : desc(trainingSkillTypes.code)]
          : params.sort === 'holders'
            ? [
                params.dir === 'asc'
                  ? asc(sql`count(${trainingSkillAssignments.id})`)
                  : desc(sql`count(${trainingSkillAssignments.id})`),
              ]
            : [params.dir === 'asc' ? asc(trainingSkillTypes.name) : desc(trainingSkillTypes.name)]

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
        and(
          eq(trainingSkillAssignments.skillTypeId, trainingSkillTypes.id),
          isNull(trainingSkillAssignments.deletedAt),
          sql`${trainingSkillAssignments.id} IN (SELECT id FROM report_skill_assignments WHERE person_status = 'active')`,
        ),
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

  const sortProps = { basePath: '/training/skills/types', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_1a286702b9eafe')}
            description={tGenerated('m_02a1574f4abe4e')}
            actions={
              <Link
                href="/training/authorities"
                className="text-sm text-teal-700 hover:underline dark:text-teal-400"
              >
                <GeneratedText id="m_01dad3205b5848" />
              </Link>
            }
          />
          <TrainingSubNav active="skill-types" />
          <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <summary className="cursor-pointer text-sm font-medium">
              <GeneratedText id="m_0af680c2c0e3dd" />
            </summary>
            <form action={createSkillType} className="mt-3 flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1 text-sm">
                <GeneratedText id="m_02b18d5c7f6f2d" />
                <Input name="name" required maxLength={200} />
              </label>
              <label className="min-w-48 flex-1 text-sm">
                <GeneratedText id="m_012397255c5bd0" />
                <Select name="authorityId" required>
                  <option value="">Choose authority</option>
                  {authorities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="submit">
                <GeneratedText id="m_017309f0f9f564" />
              </Button>
            </form>
          </details>
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_19fafa6e6f6775')} />
            <GeneratedValue
              value={
                authorities.length > 0 ? (
                  <FilterChips
                    basePath="/training/skills/types"
                    currentParams={sp}
                    paramKey="authority"
                    label={tGenerated('m_012397255c5bd0')}
                    options={authorities.map((a) => ({ value: a.id, label: a.name }))}
                  />
                ) : null
              }
            />
            <FilterChips
              basePath="/training/skills/types"
              currentParams={sp}
              paramKey="active"
              label={tGenerated('m_18f842f77b3c8b')}
              options={[
                { value: '1', label: 'Active' },
                { value: '0', label: 'Inactive' },
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
              icon={<Award size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_0f5992cf8e2286', { value0: params.q })
                  : tGenerated('m_0577337dc146c0'),
              )}
              description={tGenerated('m_038faeaefa81fa')}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="authority"
                      active={params.sort === 'authority'}
                    >
                      <GeneratedText id="m_012397255c5bd0" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="code" active={params.sort === 'code'}>
                      <GeneratedText id="m_0570e24c85cf95" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_10df4bba8fe3ad" />
                    </TableHead>
                    <SortableTh {...sortProps} column="holders" active={params.sort === 'holders'}>
                      <GeneratedText id="m_196b2418a9876a" />
                    </SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ type, authority, holders }) => (
                      <TableRow key={type.id}>
                        <TableCell>
                          <Link
                            href={`/training/skills/types/${type.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={type.name} />
                            {!type.isActive ? (
                              <span className="ml-2 text-xs text-slate-500">
                                <GeneratedText id="m_0f47ea07c99dba" />
                              </span>
                            ) : null}
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <Link
                            href={`/training/authorities/${authority.id}`}
                            className="hover:underline"
                          >
                            <GeneratedValue value={authority.name} />
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
                          <GeneratedValue value={holders} />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath="/training/skills/types"
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
