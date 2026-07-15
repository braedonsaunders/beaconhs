'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle(id)
      }}
      aria-label={tGeneratedValue(`${selected ? 'Deselect' : 'Select'} ${label}`)}
      aria-pressed={selected}
      className={selectionButtonClass}
    >
      <GeneratedValue
        value={
          selected ? (
            <CheckSquare size={16} className="text-teal-700 dark:text-teal-400" />
          ) : (
            <Square size={16} />
          )
        }
      />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <button
      type="button"
      onClick={onToggleAll}
      aria-label={tGeneratedValue(
        allSelected ? tGenerated('m_1a255bdfbfd2e9') : tGenerated('m_19cddb09497af5'),
      )}
      aria-pressed={allSelected}
      className={selectionButtonClass}
    >
      <GeneratedValue
        value={
          allSelected ? (
            <CheckSquare size={16} className="text-teal-700 dark:text-teal-400" />
          ) : (
            <Square size={16} />
          )
        }
      />
    </button>
  )
}
