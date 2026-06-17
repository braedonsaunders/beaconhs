'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import {
  BulkPeopleBar,
  HeaderSelectAll,
  SelectionCheckbox,
  type DepartmentOption,
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
  departments,
  basePath,
  currentParams,
  sort,
  dir,
}: {
  rows: PeopleTableRow[]
  groups: GroupOption[]
  departments: DepartmentOption[]
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
        {rows.map((r) => (
          <ListCard
            key={r.id}
            href={`/people/${r.id}`}
            leading={
              <SelectionCheckbox id={r.id} selected={selected.has(r.id)} onToggle={toggleOne} />
            }
            avatarName={`${r.lastName}, ${r.firstName}`}
            reference={r.employeeNo ?? undefined}
            status={
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
            }
            title={`${r.lastName}, ${r.firstName}`}
            meta={
              [r.departmentName, r.tradeName, r.hireDate ? `Hired ${r.hireDate}` : null]
                .filter(Boolean)
                .join(' · ') || undefined
            }
          />
        ))}
      </MobileCardList>

      {/* Tablet/desktop: full sortable table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              <th className="w-8 px-3 py-2">
                <HeaderSelectAll allSelected={allSelected} onToggleAll={toggleAll} />
              </th>
              <SortTh column="name" {...sortProps}>
                Name
              </SortTh>
              <SortTh column="employee_no" {...sortProps}>
                Employee #
              </SortTh>
              <SortTh column="department" {...sortProps}>
                Department
              </SortTh>
              <SortTh column="trade" {...sortProps}>
                Trade
              </SortTh>
              <SortTh column="hire_date" {...sortProps}>
                Hire date
              </SortTh>
              <SortTh column="status" {...sortProps}>
                Status
              </SortTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => {
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
                  <td className="w-8 px-3 py-2">
                    <SelectionCheckbox id={r.id} selected={isSelected} onToggle={toggleOne} />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/people/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {r.lastName}, {r.firstName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.employeeNo ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.departmentName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.tradeName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.hireDate ?? '—'}
                  </td>
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
        departments={departments}
      />
    </>
  )
}
