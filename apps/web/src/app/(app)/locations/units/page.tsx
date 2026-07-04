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

export const metadata = { title: 'Locations — Org units' }
export const dynamic = 'force-dynamic'

const BASE = '/locations/units'
const LEVELS = ['customer', 'project', 'site', 'area'] as const
const UNIT_SORTS = ['name', 'level', 'code'] as const

export default async function OrgUnitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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

  const { rows, total, levelCounts, activeCount, archivedCount, syncOrigins, parentOptions } =
    await ctx.db(async (tx) => {
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

      const parentOptions = await tx
        .select({ id: orgUnits.id, name: orgUnits.name, level: orgUnits.level })
        .from(orgUnits)
        .where(isNull(orgUnits.deletedAt))
        .orderBy(asc(orgUnits.level), asc(orgUnits.name))
        .limit(500)

      return {
        rows: pageRows,
        total: Number(tot?.c ?? 0),
        levelCounts,
        activeCount: Number(tallies?.active ?? 0),
        archivedCount: Number(tallies?.archived ?? 0),
        syncOrigins,
        parentOptions,
      }
    })

  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }
  const newHref = mergeHref(BASE, sp, { drawer: 'new', error: undefined })
  const closeHref = mergeHref(BASE, sp, { drawer: undefined, error: undefined })

  return (
    <ListPageLayout
      header={
        <>
          <LocationsSubNav active="units" />
          <PageHeader
            title="Org units"
            description="The full customer / project / site / area tree in one flat, searchable list. Edit a unit's details from its location page."
            actions={
              <Link href={newHref as never} scroll={false}>
                <Button>
                  <Plus size={14} /> Add org unit
                </Button>
              </Link>
            }
          />
          {errorMsg ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              {errorMsg}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder="Search by name or code" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label="Status"
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
              label="Level"
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
      {rows.length === 0 ? (
        <EmptyState
          title={params.q ? `No org units match "${params.q}"` : 'No org units'}
          description="Add a customer, project, site or area to build your hierarchy."
          action={
            params.q ? undefined : (
              <Link href={newHref as never} scroll={false}>
                <Button>Add org unit</Button>
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
                  Name
                </SortableTh>
                <SortableTh {...sortProps} column="level" active={params.sort === 'level'}>
                  Level
                </SortableTh>
                <TableHead>Parent</TableHead>
                <SortableTh {...sortProps} column="code" active={params.sort === 'code'}>
                  Code
                </SortableTh>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => {
                const origin = syncOrigins.get(u.id)
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/locations/${u.id}`}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {u.name}
                        </Link>
                        {u.deletedAt ? <Badge variant="warning">Archived</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{levelLabel(u.level)}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {u.parentName ? (
                        <span>
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            {levelLabel(u.parentLevel!)}:{' '}
                          </span>
                          {u.parentName}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                      {u.code ?? '—'}
                    </TableCell>
                    <TableCell>
                      {origin ? (
                        <Badge variant="secondary" title={`Synced from ${origin.connectionName}`}>
                          <Lock size={11} /> {origin.sourceSystem}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">Manual</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {u.deletedAt ? (
                        <Link
                          href={`/locations/${u.id}`}
                          className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                        >
                          Restore
                        </Link>
                      ) : origin ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500"
                          title={`Synced from ${origin.connectionName} — disable the connection to edit`}
                        >
                          <Lock size={11} /> Synced
                        </span>
                      ) : (
                        <form action={deleteOrgUnit} className="inline">
                          <input type="hidden" name="id" value={u.id} />
                          <ConfirmButton
                            message={`Archive "${u.name}"? It disappears from pickers and this list; restore it from its location page.`}
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 dark:hover:text-red-400"
                          >
                            <Trash2 size={12} />
                          </ConfirmButton>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
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
      )}

      <OrgUnitDrawer
        open={pickString(sp.drawer) === 'new'}
        closeHref={closeHref}
        levels={LEVELS.map((l) => ({ value: l, label: levelLabel(l) }))}
        parentOptions={parentOptions.map((u) => ({
          value: u.id,
          label: `${levelLabel(u.level)}: ${u.name}`,
        }))}
        saveAction={addOrgUnit}
      />
    </ListPageLayout>
  )
}
