'use client'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { RowSelectionButton, SelectVisibleRowsButton } from '@/components/row-selection-buttons'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { useRowSelection } from '@/lib/row-selection'
import { BulkPpeBar } from './_bulk-bar'
import {
  ppeInspectionStateLabel,
  type PpeInspectionKind,
  type PpeInspectionState,
} from '@/lib/ppe-inspection-due'

export type PpeTableRow = {
  id: string
  typeName: string
  serialNumber: string | null
  size: string | null
  status: 'in_stock' | 'issued' | 'returned' | 'out_of_service' | 'discarded' | 'expired'
  holderName: string | null
  assignedOn: string | null
  lastInspectionOn: string | null
  inspectionKind: PpeInspectionKind | null
  inspectionState: PpeInspectionState
  inspectionDueOn: string | null
  inspectionActionable: boolean
}

function InspectionBadge({ state }: { state: PpeInspectionState }) {
  const variant =
    state === 'overdue'
      ? 'destructive'
      : state === 'due_today' || state === 'never_inspected' || state === 'required'
        ? 'warning'
        : state === 'current'
          ? 'success'
          : 'secondary'
  return <Badge variant={variant}>{ppeInspectionStateLabel(state)}</Badge>
}

function inspectionHref(row: PpeTableRow): string {
  if (!row.inspectionActionable || !row.inspectionKind) return `/ppe/${row.id}`
  return `/ppe/${row.id}?tab=${row.inspectionKind === 'annual' ? 'annual' : 'inspections'}&drawer=record-inspection&kind=${row.inspectionKind}`
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
              href={inspectionHref(r)}
              leading={
                <RowSelectionButton id={r.id} selected={selected.has(r.id)} onToggle={toggleOne} />
              }
              person={r.holderName}
              reference={r.serialNumber ?? undefined}
              status={<InspectionBadge state={r.inspectionState} />}
              title={tGeneratedValue(r.typeName)}
              meta={
                [
                  r.size,
                  r.assignedOn ? `Assigned ${r.assignedOn}` : null,
                  r.inspectionDueOn ? `Due ${r.inspectionDueOn}` : null,
                  r.status !== 'issued' ? r.status.replace('_', ' ') : null,
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
                <GeneratedText id="m_01b37a056e66e4" />
              </SortTh>
              <SortTh column="holder" {...sortProps}>
                <GeneratedText id="m_1a298419b85cba" />
              </SortTh>
              <SortTh column="next_inspection" {...sortProps}>
                <GeneratedText id="m_0ef24e5f31b073" />
              </SortTh>
              <SortTh column="status" {...sortProps}>
                <GeneratedText id="m_0b9da892d6faf0" />
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
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue
                          value={
                            [r.serialNumber, r.size].filter(Boolean).join(' · ') || 'No identifier'
                          }
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-slate-700 dark:text-slate-300">
                        <GeneratedValue value={r.holderName ?? 'Unassigned'} />
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue
                          value={r.assignedOn ? `Assigned ${r.assignedOn}` : 'Not assigned'}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <InspectionBadge state={r.inspectionState} />
                        <GeneratedValue
                          value={
                            r.inspectionActionable && r.inspectionKind ? (
                              <Link
                                href={inspectionHref(r) as any}
                                className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300"
                              >
                                <GeneratedText id="m_1282216b6c0ab5" />
                              </Link>
                            ) : null
                          }
                        />
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue
                          value={
                            r.inspectionDueOn
                              ? `Due ${r.inspectionDueOn}`
                              : r.lastInspectionOn
                                ? `Last inspected ${r.lastInspectionOn}`
                                : null
                          }
                        />
                      </div>
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
