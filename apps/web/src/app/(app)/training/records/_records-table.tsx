'use client'

import Link from 'next/link'
import { FileText } from 'lucide-react'
import { Badge, Button } from '@beaconhs/ui'
import { RowSelectionButton, SelectVisibleRowsButton } from '@/components/row-selection-buttons'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { useRowSelection } from '@/lib/row-selection'
import { BulkTrainingRecordsBar } from './_bulk-bar'

export type TrainingRecordsTableRow = {
  id: string
  personId: string
  personFirstName: string
  personLastName: string
  personEmployeeNo: string | null
  courseId: string
  courseCode: string
  courseName: string
  completedOn: string | null
  expiresOn: string | null
  source: string
  daysToExpiry: number | null // negative = overdue, null = no expiry
  // A newer record exists for the same person + course (retrained since), so
  // this row is history — never flagged as expired/expiring.
  superseded: boolean
}

export function TrainingRecordsTable({
  rows,
  basePath,
  currentParams,
  sort,
  dir,
  canManage,
  canExport,
}: {
  rows: TrainingRecordsTableRow[]
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  sort: string
  dir: 'asc' | 'desc'
  /** training.record.create — gates the bulk Renew/Revoke actions. */
  canManage: boolean
  /** training.read.all — gates the bulk CSV export. */
  canExport: boolean
}) {
  // No bulk action available → no row selection at all (e.g. a self-only viewer
  // who can see their own records but neither manage nor bulk-export them).
  const bulkEnabled = canManage || canExport
  const { selected, selectedIds, allSelected, toggleOne, toggleAll, clear } = useRowSelection(rows)

  const sortProps = { basePath, currentParams, sort, dir }

  return (
    <>
      {/* Phones: tappable cards. Credential downloads live on the record page. */}
      <MobileCardList>
        {rows.map((r) => {
          const expiryClass =
            r.superseded || r.daysToExpiry === null
              ? 'text-slate-400'
              : r.daysToExpiry < 0
                ? 'font-medium text-red-700 dark:text-red-400'
                : r.daysToExpiry <= 30
                  ? 'font-medium text-amber-700 dark:text-amber-400'
                  : 'text-slate-500 dark:text-slate-400'
          return (
            <ListCard
              key={r.id}
              href={`/training/records/${r.id}`}
              leading={
                bulkEnabled ? (
                  <RowSelectionButton
                    id={r.id}
                    selected={selected.has(r.id)}
                    onToggle={toggleOne}
                  />
                ) : undefined
              }
              person={`${r.personLastName}, ${r.personFirstName}`}
              reference={r.courseCode}
              status={
                r.superseded ? (
                  <Badge variant="secondary">Superseded</Badge>
                ) : r.daysToExpiry !== null && r.daysToExpiry < 0 ? (
                  <Badge variant="destructive">Expired</Badge>
                ) : undefined
              }
              title={r.courseName}
              meta={
                <>
                  {r.personEmployeeNo ? `#${r.personEmployeeNo} · ` : ''}
                  <span className={expiryClass}>
                    {r.expiresOn ? `Expires ${r.expiresOn}` : 'No expiry'}
                  </span>
                  {r.completedOn ? ` · Completed ${r.completedOn}` : ''}
                </>
              }
            />
          )
        })}
      </MobileCardList>

      {/* Tablet/desktop: full sortable table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              {bulkEnabled ? (
                <th className="w-8 px-3 py-2">
                  <SelectVisibleRowsButton allSelected={allSelected} onToggleAll={toggleAll} />
                </th>
              ) : null}
              <SortTh column="employee" {...sortProps}>
                Employee
              </SortTh>
              <SortTh column="course" {...sortProps}>
                Course
              </SortTh>
              <SortTh column="completed_on" {...sortProps}>
                Completed
              </SortTh>
              <SortTh column="expires_on" {...sortProps}>
                Expires
              </SortTh>
              <SortTh column="source" {...sortProps}>
                Source
              </SortTh>
              <th className="px-3 py-2 text-right">Credentials</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => {
              const isSelected = selected.has(r.id)
              const expiryClass =
                r.superseded || r.daysToExpiry === null
                  ? 'text-slate-400'
                  : r.daysToExpiry < 0
                    ? 'text-red-700 dark:text-red-400 font-medium'
                    : r.daysToExpiry <= 30
                      ? 'text-amber-700 dark:text-amber-400 font-medium'
                      : 'text-slate-700 dark:text-slate-300'
              return (
                <tr
                  key={r.id}
                  className={
                    isSelected
                      ? 'bg-teal-50/40 dark:bg-teal-500/10'
                      : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/60'
                  }
                >
                  {bulkEnabled ? (
                    <td className="w-8 px-3 py-2">
                      <RowSelectionButton id={r.id} selected={isSelected} onToggle={toggleOne} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <Link
                      href={`/people/${r.personId}?tab=training` as any}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {r.personLastName}, {r.personFirstName}
                    </Link>
                    {r.personEmployeeNo ? (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        #{r.personEmployeeNo}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/training/records/${r.id}` as any}
                      className="text-slate-700 hover:underline dark:text-slate-300"
                    >
                      <span className="font-mono text-xs">{r.courseCode}</span> · {r.courseName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600 tabular-nums dark:text-slate-400">
                    {r.completedOn ?? '—'}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${expiryClass}`}>
                    {r.expiresOn ?? 'Never'}
                    {r.superseded ? (
                      <Badge variant="secondary" className="ml-2">
                        Superseded
                      </Badge>
                    ) : r.daysToExpiry !== null && r.daysToExpiry < 0 ? (
                      <Badge variant="destructive" className="ml-2">
                        Expired
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                    {r.source.replace('_', ' ')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/training/records/${r.id}?tab=outputs`}>
                          <FileText size={15} /> View
                        </Link>
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {bulkEnabled ? (
        <BulkTrainingRecordsBar
          selectedIds={selectedIds}
          onClear={clear}
          canManage={canManage}
          canExport={canExport}
        />
      ) : null}
    </>
  )
}
