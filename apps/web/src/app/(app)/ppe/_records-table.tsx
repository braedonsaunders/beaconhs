'use client'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { RowSelectionButton, SelectVisibleRowsButton } from '@/components/row-selection-buttons'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { useRowSelection } from '@/lib/row-selection'
import { BulkPpeBar } from './_bulk-bar'

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
  basePath,
  currentParams,
  sort,
  dir,
}: {
  rows: PpeTableRow[]
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  sort: string
  dir: 'asc' | 'desc'
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const { selected, selectedIds, allSelected, toggleOne, toggleAll, clear } = useRowSelection(rows)

  const sortProps = { basePath, currentParams, sort, dir }

  return (
    <>
      {/* Phones: tappable cards (bulk-select via the leading checkbox). */}
      <MobileCardList>
        <GeneratedValue
          value={rows.map((r) => (
            <ListCard
              key={r.id}
              href={`/ppe/${r.id}`}
              leading={
                <RowSelectionButton id={r.id} selected={selected.has(r.id)} onToggle={toggleOne} />
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
                  <GeneratedValue value={r.status.replace('_', ' ')} />
                </Badge>
              }
              title={tGeneratedValue(r.typeName)}
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
        />
      </MobileCardList>

      {/* Tablet/desktop: full sortable table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              <th className="w-8 px-3 py-2">
                <SelectVisibleRowsButton allSelected={allSelected} onToggleAll={toggleAll} />
              </th>
              <SortTh column="type" {...sortProps}>
                <GeneratedText id="m_074ba2f160c506" />
              </SortTh>
              <SortTh column="serial" {...sortProps}>
                <GeneratedText id="m_179218139b624a" />
              </SortTh>
              <SortTh column="size" {...sortProps}>
                <GeneratedText id="m_11ad4bbeced31b" />
              </SortTh>
              <SortTh column="status" {...sortProps}>
                <GeneratedText id="m_0b9da892d6faf0" />
              </SortTh>
              <SortTh column="holder" {...sortProps}>
                <GeneratedText id="m_1dd437d2b4ab7f" />
              </SortTh>
              <SortTh column="assigned" {...sortProps}>
                <GeneratedText id="m_016857a3d2e2bf" />
              </SortTh>
              <SortTh column="last_inspection" {...sortProps}>
                <GeneratedText id="m_0dfaff1020582b" />
              </SortTh>
              <SortTh column="next_inspection" {...sortProps}>
                <GeneratedText id="m_1fb9055f09702d" />
              </SortTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            <GeneratedValue
              value={rows.map((r) => {
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
                      <RowSelectionButton id={r.id} selected={isSelected} onToggle={toggleOne} />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/ppe/${r.id}` as any}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        <GeneratedValue value={r.typeName} />
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <GeneratedValue value={r.serialNumber ?? '—'} />
                    </td>
                    <td className="px-3 py-2">
                      <GeneratedValue value={r.size ?? '—'} />
                    </td>
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
                        <GeneratedValue value={r.status.replace('_', ' ')} />
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.holderName ?? '—'} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.assignedOn ?? '—'} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.lastInspectionOn ?? '—'} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.nextInspectionDue ?? '—'} />
                    </td>
                  </tr>
                )
              })}
            />
          </tbody>
        </table>
      </div>
      <BulkPpeBar selectedIds={selectedIds} onClear={clear} />
    </>
  )
}
