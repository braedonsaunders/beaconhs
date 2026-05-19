'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
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
}: {
  rows: RecordsTableRow[]
  owners: OwnerOption[]
  today: string
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

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-8 px-3 py-2">
                <HeaderSelectAll allSelected={allSelected} onToggleAll={toggleAll} />
              </th>
              <th className="px-3 py-2">Ref</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Site</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const overdue =
                r.dueOn && r.dueOn < today && !['closed', 'cancelled'].includes(r.status)
              const isSelected = selected.has(r.id)
              return (
                <tr
                  key={r.id}
                  className={isSelected ? 'bg-teal-50/40' : 'hover:bg-slate-50/50'}
                >
                  <td className="w-8 px-3 py-2">
                    <SelectionCheckbox
                      id={r.id}
                      selected={isSelected}
                      onToggle={toggleOne}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/corrective-actions/${r.id}` as any}
                      className="hover:underline"
                    >
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/corrective-actions/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline"
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
                    <span className={overdue ? 'font-medium text-red-700' : ''}>
                      {r.dueOn ?? '—'}
                      {overdue ? ' (overdue)' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.ownerName ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.siteName ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BulkReassignBar
        selectedIds={Array.from(selected)}
        onClear={clear}
        owners={owners}
      />
    </>
  )
}
