'use client'

// Row selection for an app's records list. The table itself is server
// rendered; these client pieces share one selection through context: a select
// control per row (a lock for submitted, locked records, which cannot be
// deleted), select-all in the header, and the floating bar that appears only
// while something is selected.

import { createContext, use, useMemo, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Trash2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import {
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import { FloatingSelectionBar } from '@/components/floating-selection-bar'
import { RowSelectionButton, SelectVisibleRowsButton } from '@/components/row-selection-buttons'
import { confirmDialog } from '@/lib/confirm'
import { useRowSelection } from '@/lib/row-selection'
import { toast } from '@/lib/toast'
import { bulkDeleteBuilderResponses } from './_bulk-delete-action'

type Selection = ReturnType<typeof useRowSelection>
const SelectionContext = createContext<Selection | null>(null)

function useSelection(): Selection {
  const selection = use(SelectionContext)
  if (!selection) throw new Error('ResponseSelection is missing')
  return selection
}

export function ResponseSelection({
  templateId,
  selectableIds,
  children,
}: {
  templateId: string
  /** Rows on this page the viewer may delete. */
  selectableIds: string[]
  children: ReactNode
}) {
  const t = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const rows = useMemo(() => selectableIds.map((id) => ({ id })), [selectableIds])
  const selection = useRowSelection(rows)
  const count = selection.selectedIds.length

  async function remove() {
    const ok = await confirmDialog({
      title: t('Delete selected records?'),
      message: t('They are archived and removed from any linked assessments.'),
      confirmLabel: t('Delete'),
      tone: 'danger',
    })
    if (!ok) return
    start(async () => {
      const result = await bulkDeleteBuilderResponses({
        templateId,
        responseIds: selection.selectedIds,
      }).catch(() => ({
        ok: false as const,
        error: 'The records could not be deleted. Try again.',
      }))
      if (!result.ok) {
        toast.error(t(result.error))
        return
      }
      selection.clear()
      router.refresh()
    })
  }

  return (
    <SelectionContext value={selection}>
      {children}
      {count > 0 ? (
        <FloatingSelectionBar
          label={tGenerated('m_003230c068558e', { value0: count })}
          onClear={selection.clear}
          clearDisabled={pending}
        >
          <Button size="sm" variant="destructive" disabled={pending} onClick={() => void remove()}>
            <Trash2 size={14} /> <GeneratedValue value={pending ? 'Deleting…' : 'Delete'} />
          </Button>
        </FloatingSelectionBar>
      ) : null}
    </SelectionContext>
  )
}

export function ResponseSelectAll() {
  const selection = useSelection()
  return (
    <SelectVisibleRowsButton
      allSelected={selection.allSelected}
      onToggleAll={selection.toggleAll}
    />
  )
}

export function ResponseSelectCell({
  id,
  locked,
  selectable,
}: {
  id: string
  locked: boolean
  selectable: boolean
}) {
  const t = useGeneratedValueTranslations()
  const selection = useSelection()
  if (locked) {
    const label = t('Locked responses cannot be deleted')
    return (
      <span className="inline-flex p-0.5 text-slate-500 dark:text-slate-400" title={label}>
        <Lock size={14} aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    )
  }
  if (!selectable) return null
  return (
    <RowSelectionButton
      id={id}
      ariaLabel={t('Select response')}
      selected={selection.selected.has(id)}
      onToggle={selection.toggleOne}
    />
  )
}
