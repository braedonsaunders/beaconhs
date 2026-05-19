'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import {
  BulkTrainingRecordsBar,
  HeaderSelectAll,
  SelectionCheckbox,
} from './_bulk-bar'

export type TrainingRecordsTableRow = {
  id: string
  personId: string
  personFirstName: string
  personLastName: string
  personEmployeeNo: string | null
  courseId: string
  courseCode: string
  courseName: string
  completedOn: string | null
  expiresOn: string | null
  source: string
  daysToExpiry: number | null // negative = overdue, null = no expiry
}

export function TrainingRecordsTable({ rows }: { rows: TrainingRecordsTableRow[] }) {
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
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">Course</th>
              <th className="px-3 py-2">Completed</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const isSelected = selected.has(r.id)
              const expiryClass =
                r.daysToExpiry === null
                  ? 'text-slate-400'
                  : r.daysToExpiry < 0
                    ? 'text-red-700 font-medium'
                    : r.daysToExpiry <= 30
                      ? 'text-amber-700 font-medium'
                      : 'text-slate-700'
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
                  <td className="px-3 py-2">
                    <Link
                      href={`/training/transcripts/${r.personId}` as any}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.personLastName}, {r.personFirstName}
                    </Link>
                    {r.personEmployeeNo ? (
                      <div className="text-xs text-slate-500">#{r.personEmployeeNo}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/training/records/${r.id}` as any}
                      className="text-slate-700 hover:underline"
                    >
                      <span className="font-mono text-xs">{r.courseCode}</span> · {r.courseName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600 tabular-nums">
                    {r.completedOn ?? '—'}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${expiryClass}`}>
                    {r.expiresOn ?? 'Never'}
                    {r.daysToExpiry !== null && r.daysToExpiry < 0 ? (
                      <Badge variant="destructive" className="ml-2">
                        Expired
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-600 text-xs">
                    {r.source.replace('_', ' ')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BulkTrainingRecordsBar
        selectedIds={Array.from(selected)}
        onClear={clear}
      />
    </>
  )
}
