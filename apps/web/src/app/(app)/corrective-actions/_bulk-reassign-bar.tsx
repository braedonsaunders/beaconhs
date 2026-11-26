'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserCog } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { bulkReassignCorrectiveActions } from './_actions'
import { FloatingSelectionBar } from '@/components/floating-selection-bar'

/**
 * Floating action bar on the CA list page. Once the user ticks at least one
 * row checkbox, the bar slides up from the bottom with a count and the
 * single bulk action available right now: "Reassign".
 *
 * Selection state lives in this client component (URL/cookie persistence
 * would just complicate things — the bar resets on navigation).
 */
export function BulkReassignBar({
  selectedIds,
  onClear,
}: {
  selectedIds: string[]
  onClear: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [ownerId, setOwnerId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const label = useMemo(
    () => `${selectedIds.length} action${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0) return null

  function go() {
    if (!ownerId) {
      setError(tGenerated('m_1cf8dc3e2ccd3b'))
      return
    }
    setError(tGeneratedValue(null))
    start(async () => {
      const res = await bulkReassignCorrectiveActions({
        caIds: selectedIds,
        newOwnerTenantUserId: ownerId,
      })
      if (!res.ok) {
        setError(tGeneratedValue(res.error))
        return
      }
      onClear()
      router.refresh()
    })
  }

  return (
    <FloatingSelectionBar label={label} onClear={onClear}>
      <div className="flex items-center gap-2">
        <UserCog size={14} className="text-slate-500" />
        <RemoteSearchSelect
          lookup="corrective-action-owners"
          value={ownerId}
          onChange={(val) => setOwnerId(val)}
          placeholder={tGenerated('m_0969d994e26813')}
          searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
          sheetTitle="Select a person"
          className="h-8 min-w-[12rem]"
          disabled={pending}
        />
      </div>
      <Button size="sm" onClick={go} disabled={pending}>
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_13a81772640500" />
            ) : (
              <GeneratedText id="m_1c47dadad9a28f" />
            )
          }
        />
      </Button>
      <GeneratedValue
        value={
          error ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              <GeneratedValue value={error} />
            </span>
          ) : null
        }
      />
    </FloatingSelectionBar>
  )
}

/**
 * Row-level checkbox cell. Rendered next to each CA row so the user can
 * pick the rows that the BulkReassignBar then operates on.
 */
