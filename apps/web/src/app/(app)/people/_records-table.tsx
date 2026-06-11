'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import {
  BulkPeopleBar,
  HeaderSelectAll,
  SelectionCheckbox,
  type DivisionOption,
  type GroupOption,
} from './_bulk-bar'

export type PeopleTableRow = {
  id: string
  firstName: string
  lastName: string
  employeeNo: string | null
  departmentName: string | null
  tradeName: string | null
  hireDate: string | null
  status: 'active' | 'inactive' | 'terminated'
}

export function PeopleRecordsTable({
  rows,
  groups,
  divisions,
}: {
  rows: PeopleTableRow[]
  groups: GroupOption[]
  divisions: DivisionOption[]
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
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase">
              <th className="w-8 px-3 py-2">
                <HeaderSelectAll allSelected={allSelected} onToggleAll={toggleAll} />
              </th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Employee #</th>
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Trade</th>
              <th className="px-3 py-2">Hire date</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const isSelected = selected.has(r.id)
              return (
                <tr key={r.id} className={isSelected ? 'bg-teal-50/40' : 'hover:bg-slate-50/50'}>
                  <td className="w-8 px-3 py-2">
                    <SelectionCheckbox id={r.id} selected={isSelected} onToggle={toggleOne} />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/people/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.lastName}, {r.firstName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.employeeNo ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.departmentName ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.tradeName ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.hireDate ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        r.status === 'active'
                          ? 'success'
                          : r.status === 'inactive'
                            ? 'secondary'
                            : 'destructive'
                      }
                    >
                      {r.status}
                    </Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BulkPeopleBar
        selectedIds={Array.from(selected)}
        onClear={clear}
        groups={groups}
        divisions={divisions}
      />
    </>
  )
}
