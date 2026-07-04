// Shared list + create/rename flyout for the flat People workforce taxonomies
// (trades, crews). Both are name-only lists people are assigned to; this renders
// the standard PeopleSubNav + searchable, sortable, paginated table with a
// member count and a delete row action, plus the URL-driven NameDrawer.

import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
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
import { crews, people, trades } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { NameDrawer, type NameEditing, type SaveResult } from '@/components/name-drawer'
import { PeopleSubNav, type PeopleNavSection } from './people-sub-nav'

const SORTS = ['name', 'members'] as const

export async function NameTaxonomyList({
  active,
  base,
  title,
  description,
  noun,
  table,
  assignmentColumn,
  saveAction,
  deleteAction,
  searchParams,
}: {
  active: PeopleNavSection
  base: string
  title: string
  description: string
  /** Lowercase singular for copy and the flyout ("trade"). */
  noun: string
  table: typeof trades | typeof crews
  /** people column carrying the FK to this taxonomy (people.tradeId / crewId). */
  assignmentColumn: AnyPgColumn
  saveAction: (input: { id?: string; name: string }) => Promise<SaveResult>
  deleteAction: (fd: FormData) => Promise<void>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'name', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const drawerParam = pickString(sp.drawer)
  const errorMsg = pickString(sp.error)
  const ctx = await requireModuleManage('people')

  const { rows, total } = await ctx.db(async (tx) => {
    const whereClause = params.q ? ilike(table.name, `%${params.q}%`) : undefined
    const [tot] = await tx.select({ c: count() }).from(table).where(whereClause)

    const usage = await tx
      .select({ key: assignmentColumn, c: count() })
      .from(people)
      .where(isNull(people.deletedAt))
      .groupBy(assignmentColumn)
    const usageById = new Map(usage.map((u) => [u.key as string | null, Number(u.c)]))

    const dirFn = params.dir === 'asc' ? asc : desc
    const list = await tx
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(whereClause)
      .orderBy(dirFn(table.name))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    return {
      rows: list.map((r) => ({ ...r, memberCount: usageById.get(r.id) ?? 0 })),
      total: Number(tot?.c ?? 0),
    }
  })

  const editingRow =
    drawerParam && drawerParam !== 'new' ? rows.find((r) => r.id === drawerParam) : undefined
  const editing: NameEditing | null = editingRow
    ? { id: editingRow.id, name: editingRow.name }
    : null
  const open = drawerParam === 'new' || editing !== null
  const closeHref = mergeHref(base, sp, { drawer: undefined, error: undefined })
  const newHref = mergeHref(base, sp, { drawer: 'new', error: undefined })

  return (
    <ListPageLayout
      header={
        <>
          <PeopleSubNav active={active} />
          <PageHeader
            title={title}
            description={description}
            actions={
              <Link href={newHref as never} scroll={false}>
                <Button>
                  <Plus size={14} /> Add {noun}
                </Button>
              </Link>
            }
          />
          {errorMsg ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              {errorMsg}
            </p>
          ) : null}
          <SearchInput placeholder={`Search ${title.toLowerCase()}`} />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          title={
            params.q ? `No ${title.toLowerCase()} match "${params.q}"` : `No ${title.toLowerCase()}`
          }
          description={
            params.q ? 'Try a different search.' : `Add a ${noun} people can be assigned to.`
          }
          action={
            params.q ? undefined : (
              <Link href={newHref as never} scroll={false}>
                <Button>Add {noun}</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  basePath={base}
                  currentParams={sp}
                  column="name"
                  active={params.sort === 'name'}
                  dir={params.dir}
                >
                  Name
                </SortableTh>
                <SortableTh
                  basePath={base}
                  currentParams={sp}
                  column="members"
                  active={params.sort === 'members'}
                  dir={params.dir}
                >
                  People
                </SortableTh>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const editHref = mergeHref(base, sp, { drawer: r.id, error: undefined })
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={editHref as never}
                        scroll={false}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.memberCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          href={editHref as never}
                          scroll={false}
                          className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
                        >
                          Rename
                        </Link>
                        <form action={deleteAction} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                            title={
                              r.memberCount > 0
                                ? `${r.memberCount} assigned — reassign before deleting`
                                : 'Delete'
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath={base}
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}

      <NameDrawer
        open={open}
        closeHref={closeHref}
        noun={noun}
        editing={editing}
        saveAction={saveAction}
      />
    </ListPageLayout>
  )
}
