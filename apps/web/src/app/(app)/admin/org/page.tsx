import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { Lock, Plus, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import Link from 'next/link'
import { crews, orgUnits, people, trades } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { getOrgUnitSyncOrigins, isOrgUnitSynced } from '@/lib/org-sync'
import { levelLabel } from '@/lib/org-hierarchy'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ListPageLayout } from '@/components/page-layout'
import { ConfirmButton } from '@/components/confirm-button'
import { NameDrawer, OrgUnitDrawer, type SaveResult } from './_drawers'

export const metadata = { title: 'Org hierarchy' }
export const dynamic = 'force-dynamic'

const LEVELS = ['customer', 'project', 'site', 'area'] as const
const TABS = ['units', 'trades', 'crews'] as const
const UNIT_SORTS = ['name', 'level', 'code'] as const

// Org hierarchy is admin configuration. Every action here is a POST endpoint,
// so each must gate itself — the page render gate does not protect them.
// `can` already returns true for super-admins.
async function requireOrgAdmin() {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.org.manage')) redirect('/admin')
  return ctx
}

function backWithError(message: string): never {
  redirect(`/admin/org?tab=units&error=${encodeURIComponent(message)}`)
}

async function addOrgUnit(input: {
  name: string
  level: string
  parentId: string | null
}): Promise<SaveResult> {
  'use server'
  const ctx = await requireOrgAdmin()
  const name = input.name.trim()
  const level = input.level as (typeof LEVELS)[number]
  if (!name) return { ok: false, error: 'Name is required.' }
  if (!LEVELS.includes(level)) return { ok: false, error: 'Choose a level.' }
  const parentId = input.parentId?.trim() || null
  const [row] = await ctx.db((tx) =>
    tx.insert(orgUnits).values({ tenantId: ctx.tenantId, name, level, parentId }).returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'org_unit',
      entityId: row.id,
      action: 'create',
      summary: `Added ${level} "${name}"`,
    })
  }
  revalidatePath('/admin/org')
  return { ok: true }
}

// Archive (soft delete), matching /locations semantics — org units are shared
// with the locations module, which restores archived units. Non-cascading:
// descendants are left untouched and stay visible in the list. Units still
// owned by an active data-sync connection cannot be archived here — the source
// system owns them, so the change would just be re-created on the next run.
async function deleteOrgUnit(formData: FormData) {
  'use server'
  const ctx = await requireOrgAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { before, synced } = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return { before: u ?? null, synced: u ? await isOrgUnitSynced(tx, id) : false }
  })
  if (!before || before.deletedAt) return
  if (synced) {
    backWithError(
      `"${before.name}" is synced from an external system and can't be archived here. Disable its data-sync connection first.`,
    )
  }
  await ctx.db((tx) =>
    tx.update(orgUnits).set({ deletedAt: new Date() }).where(eq(orgUnits.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'org_unit',
    entityId: id,
    action: 'archive',
    summary: `Archived ${before.level} "${before.name}"`,
    before: before as unknown as Record<string, unknown>,
  })
  revalidatePath('/admin/org')
  revalidatePath('/locations')
}

async function addTrade(input: { name: string }): Promise<SaveResult> {
  'use server'
  const ctx = await requireOrgAdmin()
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }
  const [row] = await ctx.db((tx) =>
    tx.insert(trades).values({ tenantId: ctx.tenantId, name }).returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'trade',
      entityId: row.id,
      action: 'create',
      summary: `Added trade "${name}"`,
    })
  }
  revalidatePath('/admin/org')
  return { ok: true }
}

async function deleteTrade(formData: FormData) {
  'use server'
  const ctx = await requireOrgAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { row, usage } = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(trades).where(eq(trades.id, id)).limit(1)
    const [u] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.tradeId, id), isNull(people.deletedAt)))
    return { row: r ?? null, usage: Number(u?.c ?? 0) }
  })
  if (!row) return
  if (usage > 0) {
    backWithError(
      `"${row.name}" is assigned to ${usage} ${usage === 1 ? 'person' : 'people'}. Reassign them before deleting.`,
    )
  }
  await ctx.db((tx) => tx.delete(trades).where(eq(trades.id, id)))
  await recordAudit(ctx, {
    entityType: 'trade',
    entityId: id,
    action: 'delete',
    summary: `Deleted trade "${row.name}"`,
    before: { name: row.name },
  })
  revalidatePath('/admin/org')
}

async function addCrew(input: { name: string }): Promise<SaveResult> {
  'use server'
  const ctx = await requireOrgAdmin()
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }
  const [row] = await ctx.db((tx) =>
    tx.insert(crews).values({ tenantId: ctx.tenantId, name }).returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'crew',
      entityId: row.id,
      action: 'create',
      summary: `Added crew "${name}"`,
    })
  }
  revalidatePath('/admin/org')
  return { ok: true }
}

async function deleteCrew(formData: FormData) {
  'use server'
  const ctx = await requireOrgAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { row, usage } = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(crews).where(eq(crews.id, id)).limit(1)
    const [u] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.crewId, id), isNull(people.deletedAt)))
    return { row: r ?? null, usage: Number(u?.c ?? 0) }
  })
  if (!row) return
  if (usage > 0) {
    backWithError(
      `"${row.name}" is assigned to ${usage} ${usage === 1 ? 'person' : 'people'}. Reassign them before deleting.`,
    )
  }
  await ctx.db((tx) => tx.delete(crews).where(eq(crews.id, id)))
  await recordAudit(ctx, {
    entityType: 'crew',
    entityId: id,
    action: 'delete',
    summary: `Deleted crew "${row.name}"`,
    before: { name: row.name },
  })
  revalidatePath('/admin/org')
}

export default async function AdminOrgPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireOrgAdmin()
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined
  const tab = pickActiveTab(sp, TABS, 'units')

  const addLabel = tab === 'units' ? 'Add org unit' : tab === 'trades' ? 'Add trade' : 'Add crew'
  const newHref = mergeHref('/admin/org', sp, { drawer: 'new', error: undefined })

  return (
    <ListPageLayout
      header={
        <>
          <DetailHeader
            back={{ href: '/admin', label: 'Back to admin' }}
            title="Org hierarchy"
            subtitle="Locations, projects, sites and areas, plus crews and trades"
            actions={
              <Link href={newHref as any} scroll={false}>
                <Button>
                  <Plus size={14} /> {addLabel}
                </Button>
              </Link>
            }
          />
          <TabNav
            basePath="/admin/org"
            currentParams={sp}
            active={tab}
            variant="pills"
            tabs={TABS.map((t) => ({ key: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
          />
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          ) : null}
        </>
      }
    >
      {tab === 'units' ? (
        <UnitsTab sp={sp} ctx={ctx} />
      ) : tab === 'trades' ? (
        <NameListTab
          sp={sp}
          ctx={ctx}
          title="Trades"
          table={trades}
          addAction={addTrade}
          deleteAction={deleteTrade}
        />
      ) : (
        <NameListTab
          sp={sp}
          ctx={ctx}
          title="Crews"
          table={crews}
          addAction={addCrew}
          deleteAction={deleteCrew}
        />
      )}
    </ListPageLayout>
  )
}

async function UnitsTab({
  sp,
  ctx,
}: {
  sp: Record<string, string | string[] | undefined>
  ctx: Awaited<ReturnType<typeof requireOrgAdmin>>
}) {
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: UNIT_SORTS,
  })
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

      // Status scoping is shared by every count so the chips reflect the same
      // search-filtered set the table shows.
      const statusScope =
        statusFilter === 'archived' ? [isNotNull(orgUnits.deletedAt)] : [isNull(orgUnits.deletedAt)]

      const filters = [...searchFilters, ...statusScope]
      if (levelFilter) filters.push(eq(orgUnits.level, levelFilter))
      const whereClause = and(...filters)

      // Per-level tallies (respect search + status, independent of the level pick).
      const levelRows = await tx
        .select({ level: orgUnits.level, c: count() })
        .from(orgUnits)
        .where(and(...searchFilters, ...statusScope))
        .groupBy(orgUnits.level)
      const levelCounts = new Map<string, number>()
      for (const r of levelRows) levelCounts.set(r.level, Number(r.c))

      // Active/archived tallies (respect search + level, independent of status).
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

      // Lightweight parent picker for the add form (id/name/level only — no tree
      // walk, no descendant counts). Capped so a huge synced org can't balloon
      // the page; a customer typically has far fewer than this.
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

  const sortProps = { basePath: '/admin/org', currentParams: sp, dir: params.dir }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search by name or code" />
        <FilterChips
          basePath="/admin/org"
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
          basePath="/admin/org"
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

      {rows.length === 0 ? (
        <EmptyState
          title={params.q ? `No org units match "${params.q}"` : 'No org units'}
          description="Add a customer, project, site or area below to build your hierarchy."
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
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {u.name}
                        </span>
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
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          Restore in Locations
                        </span>
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
                            message={`Archive "${u.name}"? It disappears from pickers and this list; restore it from the Locations module.`}
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
            basePath="/admin/org"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}

      <OrgUnitDrawer
        open={pickString(sp.drawer) === 'new'}
        closeHref={mergeHref('/admin/org', sp, { drawer: undefined, error: undefined })}
        levels={LEVELS.map((l) => ({ value: l, label: levelLabel(l) }))}
        parentOptions={parentOptions.map((u) => ({
          value: u.id,
          label: `${levelLabel(u.level)}: ${u.name}`,
        }))}
        saveAction={addOrgUnit}
      />
    </div>
  )
}

async function NameListTab({
  sp,
  ctx,
  title,
  table,
  addAction,
  deleteAction,
}: {
  sp: Record<string, string | string[] | undefined>
  ctx: Awaited<ReturnType<typeof requireOrgAdmin>>
  title: string
  table: typeof trades | typeof crews
  addAction: (input: { name: string }) => Promise<SaveResult>
  deleteAction: (fd: FormData) => Promise<void>
}) {
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: ['name'] as const,
  })
  const singular = title.toLowerCase().replace(/s$/, '')
  const { rows, total } = await ctx.db(async (tx) => {
    const whereClause = params.q ? ilike(table.name, `%${params.q}%`) : undefined
    const [tot] = await tx.select({ c: count() }).from(table).where(whereClause)
    const list = await tx
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(whereClause)
      .orderBy(params.dir === 'asc' ? asc(table.name) : desc(table.name))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return { rows: list, total: Number(tot?.c ?? 0) }
  })

  const sortProps = { basePath: '/admin/org', currentParams: sp, dir: params.dir }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder={`Search ${title.toLowerCase()}`} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={
            params.q ? `No ${title.toLowerCase()} match "${params.q}"` : `No ${title.toLowerCase()}`
          }
          description={`Add a ${singular} below.`}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Name
                </SortableTh>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                    {i.name}
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={deleteAction} className="inline">
                      <input type="hidden" name="id" value={i.id} />
                      <ConfirmButton
                        message={`Delete "${i.name}"? This cannot be undone.`}
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 dark:hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </ConfirmButton>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/admin/org"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <NameDrawer
        open={pickString(sp.drawer) === 'new'}
        closeHref={mergeHref('/admin/org', sp, { drawer: undefined, error: undefined })}
        noun={singular}
        saveAction={addAction}
      />
    </div>
  )
}
