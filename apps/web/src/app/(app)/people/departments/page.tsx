// /people/departments — the single People taxonomy: one department per person
// (people.departmentId). Standard table + right-side flyout for create/edit
// (?drawer=new | ?drawer=<id>); delete is a row action that refuses while the
// department is still assigned. Gated to people who can manage the org.

import Link from 'next/link'
import { Layers, Plus, Trash2 } from 'lucide-react'
import { asc, count, isNull } from 'drizzle-orm'
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
import { departments, people } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { mergeHref, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { PeopleSubNav } from '../_components/people-sub-nav'
import { DepartmentDrawer, type DepartmentEditing } from './_drawers'
import { deleteDepartment, saveDepartment } from '../_actions/departments'

export const metadata = { title: 'People — Departments' }
export const dynamic = 'force-dynamic'

const BASE = '/people/departments'

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const drawerParam = pickString(sp.drawer)
  const errorMsg = pickString(sp.error)
  const ctx = await requireModuleManage('people')

  const rows = await ctx.db(async (tx) => {
    const all = await tx.select().from(departments).orderBy(asc(departments.name))
    const counts = await tx
      .select({ deptId: people.departmentId, c: count() })
      .from(people)
      .where(isNull(people.deletedAt))
      .groupBy(people.departmentId)
    const countsById = new Map(counts.map((c) => [c.deptId, Number(c.c)]))
    return all.map((d) => ({ ...d, memberCount: countsById.get(d.id) ?? 0 }))
  })

  const editingRow =
    drawerParam && drawerParam !== 'new' ? rows.find((r) => r.id === drawerParam) : undefined
  const editing: DepartmentEditing | null = editingRow
    ? {
        id: editingRow.id,
        name: editingRow.name,
        code: editingRow.code,
        description: editingRow.description,
      }
    : null
  const mode: 'new' | 'edit' | null = drawerParam === 'new' ? 'new' : editing ? 'edit' : null
  const closeHref = mergeHref(BASE, sp, { drawer: undefined, error: undefined })
  const newHref = mergeHref(BASE, sp, { drawer: 'new', error: undefined })

  return (
    <ListPageLayout
      header={
        <>
          <PeopleSubNav active="departments" />
          <PageHeader
            title="Departments"
            description="The departments people belong to — one per person. Used for directory grouping, compliance audiences, the training matrix, and reports."
            actions={
              <Link href={newHref as any} scroll={false}>
                <Button>
                  <Plus size={14} /> Add department
                </Button>
              </Link>
            }
          />
          {errorMsg ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              {errorMsg}
            </p>
          ) : null}
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Layers size={32} />}
          title="No departments"
          description="Add your first department. Each person can then be assigned to one."
          action={
            <Link href={newHref as any} scroll={false}>
              <Button>Add department</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">People</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => {
              const editHref = mergeHref(BASE, sp, { drawer: d.id, error: undefined })
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link
                      href={editHref as any}
                      scroll={false}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {d.name}
                    </Link>
                    {d.description ? (
                      <div className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                        {d.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {d.code ? (
                      <Badge variant="outline" className="font-mono text-xs">
                        {d.code}
                      </Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {d.memberCount > 0 ? (
                      <Link
                        href={`/people?department=${d.id}` as any}
                        className="text-slate-600 tabular-nums hover:underline dark:text-slate-300"
                      >
                        {d.memberCount}
                      </Link>
                    ) : (
                      <span className="text-slate-400 tabular-nums">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        href={editHref as any}
                        scroll={false}
                        className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
                      >
                        Edit
                      </Link>
                      <form action={deleteDepartment} className="inline">
                        <input type="hidden" name="id" value={d.id} />
                        <button
                          type="submit"
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                          title={
                            d.memberCount > 0
                              ? `${d.memberCount} assigned — reassign before deleting`
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
      )}

      <DepartmentDrawer
        mode={mode}
        editing={editing}
        closeHref={closeHref}
        saveAction={saveDepartment}
      />
    </ListPageLayout>
  )
}
