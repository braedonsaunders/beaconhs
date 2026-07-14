'use client'

import Link from 'next/link'
import { RowSelectionButton, SelectVisibleRowsButton } from '@/components/row-selection-buttons'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { useRowSelection } from '@/lib/row-selection'
import { SeverityBadge, StatusBadge } from './_badges'
import { BulkIncidentsBar, type IncidentClassificationOption } from './_bulk-bar'

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
  canUpdate,
  canExport,
  basePath,
  currentParams,
  sort,
  dir,
}: {
  rows: IncidentsTableRow[]
  classifications: IncidentClassificationOption[]
  /** Archive / classification mutate rows — hidden without incidents.update. */
  canUpdate: boolean
  /** Bulk CSV export needs admin.data.export — hidden without it. */
  canExport: boolean
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  sort: string
  dir: 'asc' | 'desc'
}) {
  // No permitted bulk action → no selection UI at all.
  const selectable = canUpdate || canExport
  const { selected, selectedIds, allSelected, toggleOne, toggleAll, clear } = useRowSelection(rows)

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
              selectable ? (
                <RowSelectionButton id={r.id} selected={selected.has(r.id)} onToggle={toggleOne} />
              ) : undefined
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
              {selectable ? (
                <th className="w-8 px-3 py-2">
                  <SelectVisibleRowsButton allSelected={allSelected} onToggleAll={toggleAll} />
                </th>
              ) : null}
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
                  {selectable ? (
                    <td className="w-8 px-3 py-2">
                      <RowSelectionButton id={r.id} selected={isSelected} onToggle={toggleOne} />
                    </td>
                  ) : null}
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
      {selectable ? (
        <BulkIncidentsBar
          selectedIds={selectedIds}
          onClear={clear}
          classifications={classifications}
          canUpdate={canUpdate}
          canExport={canExport}
        />
      ) : null}
    </>
  )
}
