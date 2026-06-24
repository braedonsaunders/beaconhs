'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { BulkPpeBar, HeaderSelectAll, SelectionCheckbox, type PpeHolderOption } from './_bulk-bar'

export type PpeTableRow = {
  id: string
  typeName: string
  serialNumber: string | null
  size: string | null
  status: 'in_stock' | 'issued' | 'returned' | 'damaged' | 'discarded' | 'expired'
  holderName: string | null
  assignedOn: string | null
  lastInspectionOn: string | null
  nextInspectionDue: string | null
}

export function PpeRecordsTable({
  rows,
  holders,
  basePath,
  currentParams,
  sort,
  dir,
}: {
  rows: PpeTableRow[]
  holders: PpeHolderOption[]
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
            href={`/ppe/${r.id}`}
            leading={
              <SelectionCheckbox id={r.id} selected={selected.has(r.id)} onToggle={toggleOne} />
            }
            person={r.holderName}
            reference={r.serialNumber ?? undefined}
            status={
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
            }
            title={r.typeName}
            meta={
              [
                r.size,
                r.assignedOn ? `Assigned ${r.assignedOn}` : null,
                r.lastInspectionOn ? `Inspected ${r.lastInspectionOn}` : null,
                r.nextInspectionDue ? `Due ${r.nextInspectionDue}` : null,
              ]
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
              <SortTh column="type" {...sortProps}>
                Type
              </SortTh>
              <SortTh column="serial" {...sortProps}>
                Serial #
              </SortTh>
              <SortTh column="size" {...sortProps}>
                Size
              </SortTh>
              <SortTh column="status" {...sortProps}>
                Status
              </SortTh>
              <SortTh column="holder" {...sortProps}>
                Holder
              </SortTh>
              <SortTh column="assigned" {...sortProps}>
                Date assigned
              </SortTh>
              <SortTh column="last_inspection" {...sortProps}>
                Last inspected
              </SortTh>
              <SortTh column="next_inspection" {...sortProps}>
                Next inspection
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
                      href={`/ppe/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
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
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.holderName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.assignedOn ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.lastInspectionOn ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.nextInspectionDue ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <BulkPpeBar selectedIds={Array.from(selected)} onClear={clear} holders={holders} />
    </>
  )
}
