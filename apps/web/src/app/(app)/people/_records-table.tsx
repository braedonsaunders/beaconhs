'use client'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { RowSelectionButton, SelectVisibleRowsButton } from '@/components/row-selection-buttons'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { useRowSelection } from '@/lib/row-selection'
import { BulkPeopleBar, type DepartmentOption, type GroupOption } from './_bulk-bar'

export type PeopleTableRow = {
  id: string
  firstName: string
  lastName: string
  employeeNo: string | null
  primaryTitleName: string | null
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
  canManage,
  canExport,
}: {
  rows: PeopleTableRow[]
  groups: GroupOption[]
  departments: DepartmentOption[]
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  sort: string
  dir: 'asc' | 'desc'
  /** Viewer may run the bulk mutations (group / department / status). */
  canManage: boolean
  /** Viewer may export the selected rows to CSV. */
  canExport: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  // No bulk action is available to this viewer — skip the selection UI entirely.
  const canBulk = canManage || canExport
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
              href={`/people/${r.id}`}
              leading={
                canBulk ? (
                  <RowSelectionButton
                    id={r.id}
                    selected={selected.has(r.id)}
                    onToggle={toggleOne}
                  />
                ) : undefined
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
                  <GeneratedValue value={r.status} />
                </Badge>
              }
              title={tGeneratedValue(`${r.lastName}, ${r.firstName}`)}
              meta={
                [
                  r.primaryTitleName,
                  r.departmentName,
                  r.tradeName,
                  r.hireDate ? `Hired ${r.hireDate}` : null,
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
              <GeneratedValue
                value={
                  canBulk ? (
                    <th className="w-8 px-3 py-2">
                      <SelectVisibleRowsButton allSelected={allSelected} onToggleAll={toggleAll} />
                    </th>
                  ) : null
                }
              />
              <SortTh column="name" {...sortProps}>
                <GeneratedText id="m_02b18d5c7f6f2d" />
              </SortTh>
              <SortTh column="employee_no" {...sortProps}>
                <GeneratedText id="m_0230d1a18b5206" />
              </SortTh>
              <SortTh column="title" {...sortProps}>
                <GeneratedText id="m_1a4bbe2908d1a5" />
              </SortTh>
              <SortTh column="department" {...sortProps}>
                <GeneratedText id="m_1af68228b8305a" />
              </SortTh>
              <SortTh column="trade" {...sortProps}>
                <GeneratedText id="m_1f1e634a4380dc" />
              </SortTh>
              <SortTh column="hire_date" {...sortProps}>
                <GeneratedText id="m_1bd874d72669b8" />
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
                    <GeneratedValue
                      value={
                        canBulk ? (
                          <td className="w-8 px-3 py-2">
                            <RowSelectionButton
                              id={r.id}
                              selected={isSelected}
                              onToggle={toggleOne}
                            />
                          </td>
                        ) : null
                      }
                    />
                    <td className="px-3 py-2">
                      <Link
                        href={`/people/${r.id}` as any}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        <GeneratedValue value={r.lastName} />,{' '}
                        <GeneratedValue value={r.firstName} />
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.employeeNo ?? '—'} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.primaryTitleName ?? '—'} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.departmentName ?? '—'} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.tradeName ?? '—'} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.hireDate ?? '—'} />
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
                        <GeneratedValue value={r.status} />
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            />
          </tbody>
        </table>
      </div>
      <GeneratedValue
        value={
          canBulk ? (
            <BulkPeopleBar
              selectedIds={selectedIds}
              onClear={clear}
              groups={groups}
              departments={departments}
              canManage={canManage}
              canExport={canExport}
            />
          ) : null
        }
      />
    </>
  )
}
