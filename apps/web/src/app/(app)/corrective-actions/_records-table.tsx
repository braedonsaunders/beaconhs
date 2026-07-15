'use client'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { RowSelectionButton, SelectVisibleRowsButton } from '@/components/row-selection-buttons'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { useRowSelection } from '@/lib/row-selection'
import { BulkReassignBar } from './_bulk-reassign-bar'

export type RecordsTableRow = {
  id: string
  reference: string
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'in_progress' | 'pending_verification' | 'closed' | 'cancelled'
  dueOn: string | null
  createdAt: string
  siteName: string | null
  ownerName: string | null
  locked: boolean
}

/**
 * Client wrapper around the records table that owns the row-checkbox
 * selection state and renders the floating BulkReassignBar. Pure UI — the
 * underlying data was rendered server-side and passed in flat.
 */
export function RecordsTable({
  rows,
  today,
  canUpdate,
  basePath,
  currentParams,
  sort,
  dir,
}: {
  rows: RecordsTableRow[]
  today: string
  /** Bulk reassign mutates rows — hide the selection UI without ca.update. */
  canUpdate: boolean
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
          value={rows.map((r) => {
            const overdue =
              r.dueOn && r.dueOn < today && !['closed', 'cancelled'].includes(r.status)
            return (
              <ListCard
                key={r.id}
                href={`/corrective-actions/${r.id}`}
                leading={
                  canUpdate ? (
                    <RowSelectionButton
                      id={r.id}
                      selected={selected.has(r.id)}
                      onToggle={toggleOne}
                    />
                  ) : undefined
                }
                reference={r.reference}
                status={
                  <Badge
                    variant={
                      r.status === 'closed'
                        ? 'success'
                        : r.status === 'cancelled'
                          ? 'secondary'
                          : 'warning'
                    }
                  >
                    <GeneratedValue value={r.status.replace('_', ' ')} />
                  </Badge>
                }
                person={r.ownerName}
                title={tGeneratedValue(r.title)}
                meta={
                  <span className={overdue ? 'font-medium text-red-700 dark:text-red-400' : ''}>
                    <GeneratedValue
                      value={
                        r.dueOn ? (
                          <GeneratedText
                            id="m_0cff874a22a82c"
                            values={{ value0: r.dueOn, value1: overdue ? ' · overdue' : '' }}
                          />
                        ) : (
                          <GeneratedText id="m_08724406017e59" />
                        )
                      }
                    />
                    <GeneratedValue value={r.siteName ? ` · ${r.siteName}` : ''} />
                  </span>
                }
                footer={
                  <>
                    <Badge
                      variant={
                        r.severity === 'critical' || r.severity === 'high'
                          ? 'destructive'
                          : r.severity === 'medium'
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      <GeneratedValue value={r.severity} />
                    </Badge>
                    <GeneratedValue
                      value={
                        r.locked ? (
                          <Badge variant="outline">
                            <GeneratedText id="m_151c7008fca7d4" />
                          </Badge>
                        ) : null
                      }
                    />
                  </>
                }
              />
            )
          })}
        />
      </MobileCardList>

      {/* Tablet/desktop: full sortable table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              <GeneratedValue
                value={
                  canUpdate ? (
                    <th className="w-8 px-3 py-2">
                      <SelectVisibleRowsButton allSelected={allSelected} onToggleAll={toggleAll} />
                    </th>
                  ) : null
                }
              />
              <SortTh column="reference" {...sortProps}>
                <GeneratedText id="m_036b564bb88dfe" />
              </SortTh>
              <SortTh column="title" {...sortProps}>
                <GeneratedText id="m_0decefd558c355" />
              </SortTh>
              <SortTh column="severity" {...sortProps}>
                <GeneratedText id="m_168b365cc671bf" />
              </SortTh>
              <SortTh column="status" {...sortProps}>
                <GeneratedText id="m_0b9da892d6faf0" />
              </SortTh>
              <SortTh column="due_on" {...sortProps}>
                <GeneratedText id="m_0c2eb92551e08b" />
              </SortTh>
              <SortTh column="created_at" {...sortProps}>
                <GeneratedText id="m_10cbe051fb5e05" />
              </SortTh>
              <SortTh column="owner" {...sortProps}>
                <GeneratedText id="m_09e0cae12d3f44" />
              </SortTh>
              <SortTh column="site" {...sortProps}>
                <GeneratedText id="m_020146dd3d3d5a" />
              </SortTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            <GeneratedValue
              value={rows.map((r) => {
                const overdue =
                  r.dueOn && r.dueOn < today && !['closed', 'cancelled'].includes(r.status)
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
                        canUpdate ? (
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
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/corrective-actions/${r.id}` as any} className="hover:underline">
                        <GeneratedValue value={r.reference} />
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/corrective-actions/${r.id}` as any}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        <GeneratedValue value={r.title} />
                      </Link>
                      <GeneratedValue
                        value={
                          r.locked ? (
                            <Badge variant="outline" className="ml-2">
                              <GeneratedText id="m_151c7008fca7d4" />
                            </Badge>
                          ) : null
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          r.severity === 'critical' || r.severity === 'high'
                            ? 'destructive'
                            : r.severity === 'medium'
                              ? 'warning'
                              : 'secondary'
                        }
                      >
                        <GeneratedValue value={r.severity} />
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          r.status === 'closed'
                            ? 'success'
                            : r.status === 'cancelled'
                              ? 'secondary'
                              : 'warning'
                        }
                      >
                        <GeneratedValue value={r.status.replace('_', ' ')} />
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <span className={overdue ? 'font-medium text-red-700 dark:text-red-400' : ''}>
                        <GeneratedValue value={r.dueOn ?? '—'} />
                        <GeneratedValue
                          value={overdue ? <GeneratedText id="m_0edba4030e6f71" /> : ''}
                        />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.createdAt} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.ownerName ?? '—'} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      <GeneratedValue value={r.siteName ?? '—'} />
                    </td>
                  </tr>
                )
              })}
            />
          </tbody>
        </table>
      </div>
      <GeneratedValue
        value={canUpdate ? <BulkReassignBar selectedIds={selectedIds} onClear={clear} /> : null}
      />
    </>
  )
}
