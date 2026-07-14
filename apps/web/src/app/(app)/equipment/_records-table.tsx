'use client'

import Link from 'next/link'
import { Badge } from '@beaconhs/ui'
import { RowSelectionButton, SelectVisibleRowsButton } from '@/components/row-selection-buttons'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { useRowSelection } from '@/lib/row-selection'
import { BulkEquipmentBar } from './_bulk-bar'

export type EquipmentTableRow = {
  id: string
  assetTag: string
  name: string
  categoryName: string | null
  typeName: string | null
  status: 'in_service' | 'out_of_service' | 'in_repair' | 'lost' | 'retired'
  siteName: string | null
  holderName: string | null
  isMissing: boolean
  isDraft: boolean
}

export function EquipmentRecordsTable({
  rows,
  basePath,
  currentParams,
  sort,
  dir,
  canManage,
  canExport,
}: {
  rows: EquipmentTableRow[]
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  sort: string
  dir: 'asc' | 'desc'
  canManage: boolean
  canExport: boolean
}) {
  const canBulk = canManage || canExport
  const { selected, selectedIds, allSelected, toggleOne, toggleAll, clear } = useRowSelection(rows)

  const sortProps = { basePath, currentParams, sort, dir }

  return (
    <>
      {/* Phones: tappable cards (bulk-select via the leading checkbox). */}
      <MobileCardList>
        {rows.map((r) => (
          <ListCard
            key={r.id}
            href={`/equipment/${r.id}`}
            leading={
              canBulk ? (
                <RowSelectionButton id={r.id} selected={selected.has(r.id)} onToggle={toggleOne} />
              ) : undefined
            }
            person={r.holderName}
            reference={r.assetTag}
            status={
              <Badge variant={r.status === 'in_service' ? 'success' : 'warning'}>
                {r.status.replace('_', ' ')}
              </Badge>
            }
            title={r.name}
            meta={[r.categoryName, r.typeName, r.siteName].filter(Boolean).join(' · ') || undefined}
            footer={
              r.isMissing || r.isDraft ? (
                <>
                  {r.isMissing ? <Badge variant="destructive">missing</Badge> : null}
                  {r.isDraft ? <Badge variant="outline">Draft</Badge> : null}
                </>
              ) : null
            }
          />
        ))}
      </MobileCardList>

      {/* Tablet/desktop: full sortable table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
              {canBulk ? (
                <th className="w-8 px-3 py-2">
                  <SelectVisibleRowsButton allSelected={allSelected} onToggleAll={toggleAll} />
                </th>
              ) : null}
              <SortTh column="asset_tag" {...sortProps}>
                Asset tag
              </SortTh>
              <SortTh column="name" {...sortProps}>
                Name
              </SortTh>
              <SortTh column="category" {...sortProps}>
                Category
              </SortTh>
              <SortTh column="type" {...sortProps}>
                Type
              </SortTh>
              <SortTh column="status" {...sortProps}>
                Status
              </SortTh>
              <SortTh column="site" {...sortProps}>
                Site
              </SortTh>
              <SortTh column="holder" {...sortProps}>
                Holder
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
                  {canBulk ? (
                    <td className="w-8 px-3 py-2">
                      <RowSelectionButton id={r.id} selected={isSelected} onToggle={toggleOne} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/equipment/${r.id}` as any} className="hover:underline">
                      {r.assetTag}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/equipment/${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.categoryName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.typeName ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === 'in_service' ? 'success' : 'warning'}>
                      {r.status.replace('_', ' ')}
                    </Badge>
                    {r.isMissing ? (
                      <Badge variant="destructive" className="ml-1">
                        missing
                      </Badge>
                    ) : null}
                    {r.isDraft ? (
                      <Badge variant="outline" className="ml-1">
                        Draft
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.siteName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {r.holderName ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {canBulk ? (
        <BulkEquipmentBar
          selectedIds={selectedIds}
          onClear={clear}
          canManage={canManage}
          canExport={canExport}
        />
      ) : null}
    </>
  )
}
