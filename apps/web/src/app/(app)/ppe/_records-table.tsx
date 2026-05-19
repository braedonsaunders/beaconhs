'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import {
  BulkPpeBar,
  HeaderSelectAll,
  SelectionCheckbox,
  type PpeHolderOption,
} from './_bulk-bar'

export type PpeTableRow = {
  id: string
  typeName: string
  serialNumber: string | null
  size: string | null
  status: 'in_stock' | 'issued' | 'returned' | 'damaged' | 'discarded' | 'expired'
  holderName: string | null
  nextInspectionDue: string | null
}

export function PpeRecordsTable({
  rows,
  holders,
}: {
  rows: PpeTableRow[]
  holders: PpeHolderOption[]
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
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Serial #</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Holder</th>
              <th className="px-3 py-2">Next inspection</th>
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
                  <td className="px-3 py-2">
                    <Link
                      href={`/ppe/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.typeName}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.serialNumber ?? '—'}</td>
                  <td className="px-3 py-2">{r.size ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        r.status === 'issued'
                          ? 'success'
                          : r.status === 'in_stock'
                            ? 'secondary'
                            : 'warning'
                      }
                    >
                      {r.status.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.holderName ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {r.nextInspectionDue ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BulkPpeBar
        selectedIds={Array.from(selected)}
        onClear={clear}
        holders={holders}
      />
    </>
  )
}
