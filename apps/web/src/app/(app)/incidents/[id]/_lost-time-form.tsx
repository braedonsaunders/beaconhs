'use client'

// Add-row form for the Lost Time tab.  Now rendered inside a drawer; the
// parent drawer's footer Submit button targets us via `form={formId}`.

import { useTransition } from 'react'
import { Input, Label, Textarea } from '@beaconhs/ui'

const STATUSES = [
  { value: 'off_work', label: 'Off work' },
  { value: 'restricted_duty', label: 'Restricted duty' },
  { value: 'full_duty', label: 'Full duty (return to work)' },
] as const

export function LostTimeAddForm({
  addAction,
  injuryOptions,
  formId,
}: {
  addAction: (formData: FormData) => Promise<void>
  injuryOptions: { id: string; label: string }[]
  formId?: string
}) {
  const [isPending, startTransition] = useTransition()
  return (
    <form id={formId} action={(fd) => startTransition(() => addAction(fd))} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ltf-status">Status</Label>
          <select
            id="ltf-status"
            name="status"
            defaultValue="off_work"
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
            disabled={isPending}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ltf-injury">Injury</Label>
          <select
            id="ltf-injury"
            name="injuryId"
            defaultValue=""
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
            disabled={isPending}
          >
            <option value="">— Any —</option>
            {injuryOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ltf-from">From *</Label>
          <Input id="ltf-from" name="validFrom" type="date" required disabled={isPending} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ltf-to">To</Label>
          <Input id="ltf-to" name="validTo" type="date" disabled={isPending} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ltf-notes">Notes</Label>
        <Textarea
          id="ltf-notes"
          name="notes"
          rows={3}
          placeholder="Restriction summary (e.g. ‘no overhead reaching’)"
          disabled={isPending}
        />
      </div>
      <p className="text-xs text-slate-500">
        {isPending ? 'Saving…' : 'Submit from the drawer footer when ready.'}
      </p>
    </form>
  )
}
