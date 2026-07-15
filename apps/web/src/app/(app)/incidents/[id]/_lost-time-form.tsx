'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Add-row form for the Lost Time tab.  Now rendered inside a drawer; the
// parent drawer's footer Submit button targets us via `form={formId}`.

import { useTransition } from 'react'
import { Input, Label, Select, Textarea } from '@beaconhs/ui'

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
  const tGenerated = useGeneratedTranslations()
  const [isPending, startTransition] = useTransition()
  return (
    <form id={formId} action={(fd) => startTransition(() => addAction(fd))} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ltf-status">
            <GeneratedText id="m_0b9da892d6faf0" />
          </Label>
          <Select
            id="ltf-status"
            name="status"
            defaultValue="off_work"
            className="h-9 w-full pl-2 text-sm"
            disabled={isPending}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ltf-injury">
            <GeneratedText id="m_15e8c07e4a9c89" />
          </Label>
          <Select
            id="ltf-injury"
            name="injuryId"
            defaultValue=""
            className="h-9 w-full pl-2 text-sm"
            disabled={isPending}
          >
            <option value="">{'— Any —'}</option>
            {injuryOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ltf-from">
            <GeneratedText id="m_1764588d3e0bb9" />
          </Label>
          <Input id="ltf-from" name="validFrom" type="date" required disabled={isPending} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ltf-to">
            <GeneratedText id="m_0ea10a854847b2" />
          </Label>
          <Input id="ltf-to" name="validTo" type="date" disabled={isPending} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ltf-notes">
          <GeneratedText id="m_0b8dadcb78cd08" />
        </Label>
        <Textarea
          id="ltf-notes"
          name="notes"
          rows={3}
          placeholder={tGenerated('m_13073755cd91ae')}
          disabled={isPending}
        />
      </div>
      <p className="text-xs text-slate-500">
        <GeneratedValue
          value={
            isPending ? (
              <GeneratedText id="m_106811f2aac664" />
            ) : (
              <GeneratedText id="m_1691735480e09f" />
            )
          }
        />
      </p>
    </form>
  )
}
