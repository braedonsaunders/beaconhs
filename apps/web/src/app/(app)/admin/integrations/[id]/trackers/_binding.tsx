'use client'

import { useGeneratedValueTranslations } from '@/i18n/generated'
import { GeneratedValue } from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { findTrackerEquipment, saveTrackerBinding } from './_actions'

export function TrackerBinding({
  trackerId,
  itemId,
  itemLabel,
  excluded,
  suggestion,
}: {
  trackerId: string
  itemId: string | null
  itemLabel: string | null
  excluded: boolean
  suggestion: { id: string; label: string } | null
}) {
  const t = useGeneratedValueTranslations()
  const [selected, setSelected] = useState(itemId ?? '')
  const [exclude, setExclude] = useState(excluded)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <div className="min-w-64 space-y-2">
      <RemoteSearchSelect
        loadOptions={findTrackerEquipment}
        value={selected}
        onChange={(next) => {
          setSelected(next)
          if (next) setExclude(false)
        }}
        initialOption={
          selected === itemId && itemLabel
            ? { value: selected, label: itemLabel }
            : selected === suggestion?.id
              ? { value: selected, label: suggestion.label }
              : undefined
        }
        placeholder={t('Link equipment')}
        disabled={pending || exclude}
        ariaLabel={t('Equipment linked to tracker')}
      />
      {suggestion && !selected && !exclude ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setSelected(suggestion.id)}
        >
          <GeneratedValue value={'Use suggested:'} />
          {suggestion.label}
        </Button>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={exclude}
            disabled={pending}
            onChange={(event) => {
              setExclude(event.target.checked)
              if (event.target.checked) setSelected('')
            }}
          />
          <GeneratedValue value={'Exclude tracker'} />
        </label>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              const result = await saveTrackerBinding({
                trackerId,
                itemId: selected || null,
                excluded: exclude,
                expectedItemId: itemId,
              })
              if (!result.ok) setError(result.error ?? 'Could not save.')
              else router.refresh()
            })
          }
        >
          <GeneratedValue value={pending ? 'Saving…' : 'Save link'} />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
