'use client'

import { GeneratedValue } from '@/i18n/generated'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label } from '@beaconhs/ui'
import { saveOilChange } from './_oil-change-action'

export function OilChangeCard({
  itemId,
  enabled,
  interval,
  last,
  next,
  hours,
  canEdit,
}: {
  itemId: string
  enabled: boolean
  interval: number | null
  last: string | null
  next: string | null
  hours: number | null
  canEdit: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  if (!enabled && !canEdit) return null
  return (
    <details open={enabled} className="mb-4 rounded-lg border p-4">
      <summary className="cursor-pointer font-semibold">
        <GeneratedValue value={'Oil changes'} />
        {enabled && next ? (
          <>
            {' '}
            · <GeneratedValue value="Next due" /> {next}
          </>
        ) : null}
      </summary>
      {enabled && (!interval || (!last && !next)) ? (
        <p role="status" className="mt-2 text-sm text-amber-700">
          <GeneratedValue
            value={
              'Oil-change setup is incomplete. Enter the interval and last oil-change date to calculate the next due date.'
            }
          />
        </p>
      ) : null}
      <form
        className="mt-3 grid gap-3 sm:grid-cols-3"
        action={(form) =>
          start(async () => {
            setError(null)
            try {
              await saveOilChange(form)
              router.refresh()
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not save oil change.')
            }
          })
        }
      >
        <input type="hidden" name="itemId" value={itemId} />
        <label className="sm:col-span-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={enabled}
            disabled={!canEdit || pending}
          />{' '}
          <GeneratedValue value={'Track oil changes'} />
        </label>
        <div>
          <Label htmlFor="oil-last">
            <GeneratedValue value={'Last oil change'} />
          </Label>
          <Input
            id="oil-last"
            name="last"
            type="date"
            defaultValue={last ?? ''}
            disabled={!canEdit || pending}
          />
        </div>
        <div>
          <Label htmlFor="oil-interval">
            <GeneratedValue value={'Interval (months)'} />
          </Label>
          <Input
            id="oil-interval"
            name="interval"
            type="number"
            min={1}
            max={120}
            defaultValue={interval ?? ''}
            disabled={!canEdit || pending}
          />
        </div>
        <div>
          <Label htmlFor="oil-hours">
            <GeneratedValue value={'Engine hours at oil change'} />
          </Label>
          <Input
            id="oil-hours"
            name="hours"
            type="number"
            min={0}
            step="0.1"
            defaultValue={hours ?? ''}
            disabled={!canEdit || pending}
          />
        </div>
        <p className="text-sm text-slate-500 sm:col-span-3">
          <GeneratedValue
            value={
              'Saving a new oil-change date recalculates the next due date and adds a maintenance log entry.'
            }
          />
        </p>
        {error ? (
          <p role="alert" className="text-red-600 sm:col-span-3">
            {error}
          </p>
        ) : null}
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            <GeneratedValue value={pending ? 'Saving…' : 'Save oil change'} />
          </Button>
        ) : null}
      </form>
    </details>
  )
}
