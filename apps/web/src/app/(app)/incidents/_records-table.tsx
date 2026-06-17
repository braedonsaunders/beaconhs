'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
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
  involved: string[]
}

export function IncidentsRecordsTable({
  rows,
  classifications,
  basePath,
  currentParams,
  sort,
  dir,
}: {
  rows: IncidentsTableRow[]
  classifications: IncidentClassificationOption[]
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
            href={`/incidents/${r.id}`}
            leading={
              <SelectionCheckbox id={r.id} selected={selected.has(r.id)} onToggle={toggleOne} />
            }
            person={
              r.involved.length
                ? r.involved[0] + (r.involved.length > 1 ? ` +${r.involved.length - 1}` : '')
                : undefined
            }
            avatarName={r.involved[0]}
            reference={r.reference}
            status={<StatusBadge status={r.status} />}
            title={r.title}
            meta={`${new Date(r.occurredAt).toLocaleDateString()} · ${r.type.replace(/_/g, ' ')}${
              r.siteName ? ` · ${r.siteName}` : ''
            }`}
            footer={<SeverityBadge severity={r.severity} />}
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
              <SortTh column="reference" {...sortProps}>
                Ref
              </SortTh>
              <SortTh column="occurred_at" {...sortProps}>
                Occurred
              </SortTh>
              <SortTh column="type" {...sortProps}>
                Type
              </SortTh>
              <SortTh column="severity" {...sortProps}>
                Severity
              </SortTh>
              <SortTh column="status" {...sortProps}>
                Status
              </SortTh>
              <SortTh column="title" {...sortProps}>
                Title
              </SortTh>
              <SortTh column="site" {...sortProps}>
                Site
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
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                    <Link href={`/incidents/${r.id}` as any} className="hover:underline">
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {new Date(r.occurredAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
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
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {r.title}
                    </Link>
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
      <BulkIncidentsBar
        selectedIds={Array.from(selected)}
        onClear={clear}
        classifications={classifications}
      />
    </>
  )
}
