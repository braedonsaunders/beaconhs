'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { SeverityBadge, StatusBadge } from './_badges'
import {
  BulkIncidentsBar,
  HeaderSelectAll,
  SelectionCheckbox,
  type IncidentClassificationOption,
} from './_bulk-bar'

export type IncidentsTableRow = {
  id: string
  reference: string
  occurredAt: string // ISO
  type: string
  severity: string
  status: string
  title: string
  siteName: string | null
  locked: boolean
}

export function IncidentsRecordsTable({
  rows,
  classifications,
}: {
  rows: IncidentsTableRow[]
  classifications: IncidentClassificationOption[]
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
              <th className="px-3 py-2">Occurred</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Site</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
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
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">
                    <Link href={`/incidents/${r.id}` as any} className="hover:underline">
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {new Date(r.occurredAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {r.type.replace(/_/g, ' ')}
                  </td>
                  <td className="px-3 py-2">
                    <SeverityBadge severity={r.severity} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/incidents/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.siteName ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BulkIncidentsBar
        selectedIds={Array.from(selected)}
        onClear={clear}
        classifications={classifications}
      />
    </>
  )
}
