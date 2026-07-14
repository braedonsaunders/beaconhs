'use client'

import { CheckSquare, Square } from 'lucide-react'

const selectionButtonClass =
  'inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200'

export function RowSelectionButton({
  id,
  selected,
  onToggle,
  label = 'row',
}: {
  id: string
  selected: boolean
  onToggle: (id: string) => void
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle(id)
      }}
      aria-label={`${selected ? 'Deselect' : 'Select'} ${label}`}
      aria-pressed={selected}
      className={selectionButtonClass}
    >
      {selected ? (
        <CheckSquare size={16} className="text-teal-700 dark:text-teal-400" />
      ) : (
        <Square size={16} />
      )}
    </button>
  )
}

export function SelectVisibleRowsButton({
  allSelected,
  onToggleAll,
}: {
  allSelected: boolean
  onToggleAll: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggleAll}
      aria-label={allSelected ? 'Deselect all visible rows' : 'Select all visible rows'}
      aria-pressed={allSelected}
      className={selectionButtonClass}
    >
      {allSelected ? (
        <CheckSquare size={16} className="text-teal-700 dark:text-teal-400" />
      ) : (
        <Square size={16} />
      )}
    </button>
  )
}
