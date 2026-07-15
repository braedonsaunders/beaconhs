import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// /locations/units — the flat, searchable org-unit admin table across every
// level (customer / project / site / area) in one list, with a create flyout and
// soft-delete. Complements the Locations records view (which is customer-rooted
// with drill-down). Lives under Locations → Manage; gated to org admins.

import { alias } from 'drizzle-orm/pg-core'
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { Lock, Plus, Trash2 } from 'lucide-react'
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
import Link from 'next/link'
import { orgUnits } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { getOrgUnitSyncOrigins } from '@/lib/org-sync'
import { levelLabel } from '@/lib/org-hierarchy'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { ListPageLayout } from '@/components/page-layout'
import { ConfirmButton } from '@/components/confirm-button'
import { LocationsSubNav } from '@/components/locations-sub-nav'
import { OrgUnitDrawer } from './_drawers'
import { addOrgUnit, deleteOrgUnit } from '../_actions/units'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0ae516ba386169') }
}
export const dynamic = 'force-dynamic'

const BASE = '/locations/units'
const LEVELS = ['customer', 'project', 'site', 'area'] as const
const UNIT_SORTS = ['name', 'level', 'code'] as const

export default async function OrgUnitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const ctx = await requireModuleManage('locations')
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: UNIT_SORTS,
  })
  const errorMsg = pickString(sp.error)
  const statusFilter = pickString(sp.status) ?? 'active'
  const rawLevel = pickString(sp.level)
  const levelFilter = LEVELS.includes(rawLevel as (typeof LEVELS)[number])
    ? (rawLevel as (typeof LEVELS)[number])
    : undefined

  const parent = alias(orgUnits, 'parent')

  const { rows, total, levelCounts, activeCount, archivedCount, syncOrigins } = await ctx.db(
    async (tx) => {
      const searchFilters: SQL<unknown>[] = []
      if (params.q) {
        const term = `%${params.q}%`
        const cond = or(ilike(orgUnits.name, term), ilike(orgUnits.code, term))
        if (cond) searchFilters.push(cond)
      }

      const statusScope =
        statusFilter === 'archived' ? [isNotNull(orgUnits.deletedAt)] : [isNull(orgUnits.deletedAt)]

      const filters = [...searchFilters, ...statusScope]
      if (levelFilter) filters.push(eq(orgUnits.level, levelFilter))
      const whereClause = and(...filters)

      const levelRows = await tx
        .select({ level: orgUnits.level, c: count() })
        .from(orgUnits)
        .where(and(...searchFilters, ...statusScope))
        .groupBy(orgUnits.level)
      const levelCounts = new Map<string, number>()
      for (const r of levelRows) levelCounts.set(r.level, Number(r.c))

      const [tallies] = await tx
        .select({
          active: sql<string>`count(*) filter (where ${orgUnits.deletedAt} is null)`,
          archived: sql<string>`count(*) filter (where ${orgUnits.deletedAt} is not null)`,
        })
        .from(orgUnits)
        .where(and(...searchFilters, ...(levelFilter ? [eq(orgUnits.level, levelFilter)] : [])))

      const orderBy =
        params.sort === 'code'
          ? [params.dir === 'asc' ? asc(orgUnits.code) : desc(orgUnits.code)]
          : params.sort === 'level'
            ? [
                params.dir === 'asc' ? asc(orgUnits.level) : desc(orgUnits.level),
                asc(orgUnits.name),
              ]
            : [params.dir === 'asc' ? asc(orgUnits.name) : desc(orgUnits.name)]

      const [tot] = await tx.select({ c: count() }).from(orgUnits).where(whereClause)

      const pageRows = await tx
        .select({
          id: orgUnits.id,
          name: orgUnits.name,
          level: orgUnits.level,
          code: orgUnits.code,
          deletedAt: orgUnits.deletedAt,
          parentName: parent.name,
          parentLevel: parent.level,
        })
        .from(orgUnits)
        .leftJoin(parent, eq(parent.id, orgUnits.parentId))
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage)

      const syncOrigins = await getOrgUnitSyncOrigins(
        tx,
        pageRows.map((r) => r.id),
      )

      return {
        rows: pageRows,
        total: Number(tot?.c ?? 0),
        levelCounts,
        activeCount: Number(tallies?.active ?? 0),
        archivedCount: Number(tallies?.archived ?? 0),
        syncOrigins,
      }
    },
  )

  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }
  const newHref = mergeHref(BASE, sp, { drawer: 'new', error: undefined })
  const closeHref = mergeHref(BASE, sp, { drawer: undefined, error: undefined })

  return (
    <ListPageLayout
      header={
        <>
          <LocationsSubNav active="units" />
          <PageHeader
            title={tGenerated('m_13ba3f5fafdada')}
            description={tGenerated('m_05cd0fbb913bf1')}
            actions={
              <Link href={newHref as never} scroll={false}>
                <Button>
                  <Plus size={14} /> <GeneratedText id="m_1959406a59d28f" />
                </Button>
              </Link>
            }
          />
          <GeneratedValue
            value={
              errorMsg ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
                  <GeneratedValue value={errorMsg} />
                </p>
              ) : null
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder={tGenerated('m_1b2c753f4c06fa')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              defaultValue="active"
              options={[
                { value: 'active', label: 'Active', count: activeCount },
                { value: 'archived', label: 'Archived', count: archivedCount },
              ]}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="level"
              label={tGenerated('m_1cc321f2024ad6')}
              allLabel="All levels"
              options={LEVELS.map((l) => ({
                value: l,
                label: levelLabel(l, { plural: true }),
                count: levelCounts.get(l) ?? 0,
              }))}
            />
          </div>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_1ee48b9acc50cd', { value0: params.q })
                  : tGenerated('m_167430ea9f7c05'),
              )}
              description={tGenerated('m_0a8e97f0fd9b27')}
              action={
                params.q ? undefined : (
                  <Link href={newHref as never} scroll={false}>
                    <Button>
                      <GeneratedText id="m_1959406a59d28f" />
                    </Button>
                  </Link>
                )
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
                    <SortableTh {...sortProps} column="level" active={params.sort === 'level'}>
                      <GeneratedText id="m_1cc321f2024ad6" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_14583b7cc6c6f9" />
                    </TableHead>
                    <SortableTh {...sortProps} column="code" active={params.sort === 'code'}>
                      <GeneratedText id="m_0570e24c85cf95" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_1d05fa7a091a9b" />
                    </TableHead>
                    <TableHead className="text-right">
                      <GeneratedText id="m_0a7f1858f2ec46" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((u) => {
                      const origin = syncOrigins.get(u.id)
                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/locations/${u.id}`}
                                className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                              >
                                <GeneratedValue value={u.name} />
                              </Link>
                              <GeneratedValue
                                value={
                                  u.deletedAt ? (
                                    <Badge variant="warning">
                                      <GeneratedText id="m_12a687134482ba" />
                                    </Badge>
                                  ) : null
                                }
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              <GeneratedValue value={levelLabel(u.level)} />
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            <GeneratedValue
                              value={
                                u.parentName ? (
                                  <span>
                                    <span className="text-xs text-slate-400 dark:text-slate-500">
                                      <GeneratedValue value={levelLabel(u.parentLevel!)} />:
                                      <GeneratedValue value={' '} />
                                    </span>
                                    <GeneratedValue value={u.parentName} />
                                  </span>
                                ) : (
                                  '—'
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                            <GeneratedValue value={u.code ?? '—'} />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                origin ? (
                                  <Badge
                                    variant="secondary"
                                    title={tGenerated('m_04da7e7459a402', {
                                      value0: origin.connectionName,
                                    })}
                                  >
                                    <Lock size={11} />{' '}
                                    <GeneratedValue value={origin.sourceSystem} />
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-slate-400 dark:text-slate-500">
                                    <GeneratedText id="m_132166f2d04b7c" />
                                  </span>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <GeneratedValue
                              value={
                                u.deletedAt ? (
                                  <Link
                                    href={`/locations/${u.id}`}
                                    className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                                  >
                                    <GeneratedText id="m_19500e41842c99" />
                                  </Link>
                                ) : origin ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500"
                                    title={tGenerated('m_0a77e7f2617548', {
                                      value0: origin.connectionName,
                                    })}
                                  >
                                    <Lock size={11} /> <GeneratedText id="m_07ba2e86a6e153" />
                                  </span>
                                ) : (
                                  <form action={deleteOrgUnit} className="inline">
                                    <input type="hidden" name="id" value={u.id} />
                                    <ConfirmButton
                                      message={tGenerated('m_1dcdeed8176c88', { value0: u.name })}
                                      variant="ghost"
                                      size="sm"
                                      className="text-red-500 hover:text-red-700 dark:hover:text-red-400"
                                    >
                                      <Trash2 size={12} />
                                    </ConfirmButton>
                                  </form>
                                )
                              }
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath={BASE}
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />

      <OrgUnitDrawer
        open={pickString(sp.drawer) === 'new'}
        closeHref={closeHref}
        levels={LEVELS.map((l) => ({ value: l, label: levelLabel(l) }))}
        saveAction={addOrgUnit}
      />
    </ListPageLayout>
  )
}
