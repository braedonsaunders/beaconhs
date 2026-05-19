'use client'

// Inline add-row form for the Lost Time tab.  Lives next to the existing
// event table — no modal so the admin can scan history while typing.

import { useTransition } from 'react'
import { Button, Input, Label, Textarea } from '@beaconhs/ui'
import { Plus } from 'lucide-react'

const STATUSES = [
  { value: 'off_work', label: 'Off work' },
  { value: 'restricted_duty', label: 'Restricted duty' },
  { value: 'full_duty', label: 'Full duty (return to work)' },
] as const

export function LostTimeAddForm({
  addAction,
  injuryOptions,
}: {
  addAction: (formData: FormData) => Promise<void>
  injuryOptions: { id: string; label: string }[]
}) {
  const [isPending, startTransition] = useTransition()
  return (
    <form
      action={(fd) => startTransition(() => addAction(fd))}
      className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50/40 p-3 sm:grid-cols-[140px_140px_140px_180px_1fr_120px]"
    >
      <div className="space-y-1.5">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          name="status"
          defaultValue="off_work"
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="validFrom">From *</Label>
        <Input id="validFrom" name="validFrom" type="date" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="validTo">To</Label>
        <Input id="validTo" name="validTo" type="date" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="injuryId">Injury</Label>
        <select
          id="injuryId"
          name="injuryId"
          defaultValue=""
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">— Any —</option>
          {injuryOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5 sm:col-span-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={1}
          placeholder="Restriction summary (e.g. ‘no overhead reaching’)"
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={isPending} className="w-full">
          <Plus size={14} /> {isPending ? 'Saving…' : 'Add row'}
        </Button>
      </div>
    </form>
  )
}
