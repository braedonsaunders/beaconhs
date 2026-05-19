'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import {
  BulkEquipmentBar,
  HeaderSelectAll,
  SelectionCheckbox,
  type HolderOption,
  type SiteOption,
} from './_bulk-bar'

export type EquipmentTableRow = {
  id: string
  assetTag: string
  name: string
  typeName: string | null
  status: 'in_service' | 'out_of_service' | 'in_repair' | 'lost' | 'retired'
  siteName: string | null
  holderName: string | null
  isMissing: boolean
}

export function EquipmentRecordsTable({
  rows,
  sites,
  holders,
}: {
  rows: EquipmentTableRow[]
  sites: SiteOption[]
  holders: HolderOption[]
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
              <th className="px-3 py-2">Asset tag</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2">Holder</th>
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
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/equipment/${r.id}` as any} className="hover:underline">
                      {r.assetTag}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/equipment/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.typeName ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === 'in_service' ? 'success' : 'warning'}>
                      {r.status.replace('_', ' ')}
                    </Badge>
                    {r.isMissing ? (
                      <Badge variant="destructive" className="ml-1">
                        missing
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.siteName ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.holderName ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BulkEquipmentBar
        selectedIds={Array.from(selected)}
        onClear={clear}
        sites={sites}
        holders={holders}
      />
    </>
  )
}
