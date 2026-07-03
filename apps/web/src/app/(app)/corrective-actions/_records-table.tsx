'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import {
  BulkReassignBar,
  HeaderSelectAll,
  SelectionCheckbox,
  type OwnerOption,
} from './_bulk-reassign-bar'

export type RecordsTableRow = {
  id: string
  reference: string
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'in_progress' | 'pending_verification' | 'closed' | 'cancelled'
  dueOn: string | null
  createdAt: string
  siteName: string | null
  ownerName: string | null
  locked: boolean
}

/**
 * Client wrapper around the records table that owns the row-checkbox
 * selection state and renders the floating BulkReassignBar. Pure UI — the
 * underlying data was rendered server-side and passed in flat.
 */
export function RecordsTable({
  rows,
  owners,
  today,
  canUpdate,
  basePath,
  currentParams,
  sort,
  dir,
}: {
  rows: RecordsTableRow[]
  owners: OwnerOption[]
  today: string
  /** Bulk reassign mutates rows — hide the selection UI without ca.update. */
  canUpdate: boolean
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  sort: string
  dir: 'asc' | 'desc'
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  )

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected((prev) => {
      if (rows.length > 0 && rows.every((r) => prev.has(r.id))) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }
  function clear() {
    setSelected(new Set())
  }

  const sortProps = { basePath, currentParams, sort, dir }

  return (
    <>
      {/* Phones: tappable cards (bulk-select via the leading checkbox). */}
      <MobileCardList>
        {rows.map((r) => {
          const overdue = r.dueOn && r.dueOn < today && !['closed', 'cancelled'].includes(r.status)
          return (
            <ListCard
              key={r.id}
              href={`/corrective-actions/${r.id}`}
              leading={
                canUpdate ? (
                  <SelectionCheckbox id={r.id} selected={selected.has(r.id)} onToggle={toggleOne} />
                ) : undefined
              }
              reference={r.reference}
              status={
                <Badge
                  variant={
                    r.status === 'closed'
                      ? 'success'
                      : r.status === 'cancelled'
                        ? 'secondary'
                        : 'warning'
                  }
                >
                  {r.status.replace('_', ' ')}
                </Badge>
              }
              person={r.ownerName}
              title={r.title}
              meta={
                <span className={overdue ? 'font-medium text-red-700 dark:text-red-400' : ''}>
                  {r.dueOn ? `Due ${r.dueOn}${overdue ? ' · overdue' : ''}` : 'No due date'}
                  {r.siteName ? ` · ${r.siteName}` : ''}
                </span>
              }
              footer={
                <>
                  <Badge
                    variant={
                      r.severity === 'critical' || r.severity === 'high'
                        ? 'destructive'
                        : r.severity === 'medium'
                          ? 'warning'
                          : 'secondary'
                    }
                  >
                    {r.severity}
                  </Badge>
                  {r.locked ? <Badge variant="outline">locked</Badge> : null}
                </>
              }
            />
          )
        })}
      </MobileCardList>

      {/* Tablet/desktop: full sortable table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              {canUpdate ? (
                <th className="w-8 px-3 py-2">
                  <HeaderSelectAll allSelected={allSelected} onToggleAll={toggleAll} />
                </th>
              ) : null}
              <SortTh column="reference" {...sortProps}>
                Ref
              </SortTh>
              <SortTh column="title" {...sortProps}>
                Title
              </SortTh>
              <SortTh column="severity" {...sortProps}>
                Severity
              </SortTh>
              <SortTh column="status" {...sortProps}>
                Status
              </SortTh>
              <SortTh column="due_on" {...sortProps}>
                Due
              </SortTh>
              <SortTh column="created_at" {...sortProps}>
                Created
              </SortTh>
              <SortTh column="owner" {...sortProps}>
                Owner
              </SortTh>
              <SortTh column="site" {...sortProps}>
                Site
              </SortTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => {
              const overdue =
                r.dueOn && r.dueOn < today && !['closed', 'cancelled'].includes(r.status)
              const isSelected = selected.has(r.id)
              return (
                <tr
                  key={r.id}
                  className={
                    isSelected
                      ? 'bg-teal-50/40 dark:bg-teal-500/10'
                      : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/60'
                  }
                >
                  {canUpdate ? (
                    <td className="w-8 px-3 py-2">
                      <SelectionCheckbox id={r.id} selected={isSelected} onToggle={toggleOne} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/corrective-actions/${r.id}` as any} className="hover:underline">
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/corrective-actions/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {r.title}
                    </Link>
                    {r.locked ? (
                      <Badge variant="outline" className="ml-2">
                        locked
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        r.severity === 'critical' || r.severity === 'high'
                          ? 'destructive'
                          : r.severity === 'medium'
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      {r.severity}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        r.status === 'closed'
                          ? 'success'
                          : r.status === 'cancelled'
                            ? 'secondary'
                            : 'warning'
                      }
                    >
                      {r.status.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <span className={overdue ? 'font-medium text-red-700 dark:text-red-400' : ''}>
                      {r.dueOn ?? '—'}
                      {overdue ? ' (overdue)' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{r.createdAt}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.ownerName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.siteName ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {canUpdate ? (
        <BulkReassignBar selectedIds={Array.from(selected)} onClear={clear} owners={owners} />
      ) : null}
    </>
  )
}
