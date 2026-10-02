'use client'

import { GeneratedValue } from '@/i18n/generated'
import { useState, useTransition } from 'react'
import { Button, Input, Label, Textarea } from '@beaconhs/ui'
import { completeEquipmentSchedule } from './_maintenance-actions'
import { useRouter } from 'next/navigation'

export function CompleteSchedule({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <div>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        <GeneratedValue value={'Record completion'} />
      </Button>
      {open ? (
        <form
          className="mt-2 space-y-2 rounded border p-3 text-left"
          action={(form) =>
            start(async () => {
              try {
                await completeEquipmentSchedule(form)
                setOpen(false)
                router.refresh()
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Could not save completion.')
              }
            })
          }
        >
          <input type="hidden" name="scheduleId" value={id} />
          <Label>
            <GeneratedValue value={'Completed on'} />
            <Input name="completedOn" type="date" required disabled={pending} />
          </Label>
          <Label>
            <GeneratedValue value={'Completion notes / certificate reference'} />
            <Textarea name="evidence" required disabled={pending} />
          </Label>
          {error ? (
            <p role="alert" className="text-red-600">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            <GeneratedValue value={pending ? 'Saving…' : 'Save completion'} />
          </Button>
        </form>
      ) : null}
    </div>
  )
}
