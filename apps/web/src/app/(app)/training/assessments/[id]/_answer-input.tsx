'use client'

// One question's answer on an assessment attempt. Local-first: every answer is
// written to the device as it is given and synced as an `answer:<resultId>`
// edit (see ../_record-edits.ts), so a quiz keeps working with no signal.
// Submitting grades whatever is saved — see ./_submit-attempt-button.tsx.

import { Input, Select, Textarea } from '@beaconhs/ui'
import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'
import { SaveDot } from '@/components/live-field'
import { useRecordField } from '@/lib/offline-drafts/offline-record'
import type { DraftAnswerWire } from '../../_lib/grading'

type Choice = { value: string; label: string }

export function AssessmentAnswerInput({
  resultId,
  kind,
  choices,
  initialValue,
  mandatory,
  disabled,
}: {
  resultId: string
  kind: string
  /** The question's valid choice snapshot (choice questions only). */
  choices: Choice[]
  /** The saved answer in its wire form (`draftAnswerWire`). */
  initialValue: DraftAnswerWire
  mandatory: boolean
  disabled?: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const f = useRecordField<DraftAnswerWire>(`answer:${resultId}`, initialValue)
  const off = disabled || f.paused
  const status = (
    <div className="flex min-h-4 justify-end">
      <SaveDot state={f.saveState} error={f.error} onRetry={f.retry} />
    </div>
  )
  const text = typeof f.value === 'string' ? f.value : ''

  if (kind === 'text') {
    return (
      <div className="space-y-1">
        <Textarea
          rows={3}
          value={text}
          disabled={off}
          required={mandatory}
          placeholder={tGenerated('m_03679ea3fca4d3')}
          onChange={(event) => f.change(event.target.value)}
          onBlur={() => f.commit()}
        />
        {status}
      </div>
    )
  }
  if (kind === 'numeric') {
    return (
      <div className="space-y-1">
        <Input
          type="number"
          step="any"
          inputMode="decimal"
          value={text}
          disabled={off}
          required={mandatory}
          onChange={(event) => f.change(event.target.value)}
          onBlur={() => f.commit()}
        />
        {status}
      </div>
    )
  }
  if (kind === 'true_false') {
    return (
      <div className="space-y-1">
        <Select
          value={text}
          disabled={off}
          required={mandatory}
          onChange={(event) => f.commit(event.target.value)}
        >
          <option value="">{'— Pick one —'}</option>
          <option value="true">{'True'}</option>
          <option value="false">{'False'}</option>
        </Select>
        {status}
      </div>
    )
  }
  if (kind !== 'single_choice' && kind !== 'multi_choice') return null
  if (choices.length === 0) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
        <GeneratedText id="m_0988b671c7f65b" />
      </p>
    )
  }
  const selected = new Set(Array.isArray(f.value) ? f.value : f.value ? [f.value] : [])
  function toggle(value: string, checked: boolean) {
    if (kind === 'single_choice') {
      f.commit(value)
      return
    }
    const next = new Set(selected)
    if (checked) next.add(value)
    else next.delete(value)
    // Keep the question's option order, as the stored answer does.
    f.commit(choices.filter((option) => next.has(option.value)).map((option) => option.value))
  }
  return (
    <fieldset
      className="space-y-2"
      aria-label={tGenerated(kind === 'single_choice' ? 'm_17ca695e06a9f9' : 'm_09bbeb80f7afa2')}
    >
      {choices.map((option, index) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 transition-colors hover:bg-slate-50 has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50 has-[:disabled]:cursor-default dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900 dark:has-[:checked]:border-sky-500 dark:has-[:checked]:bg-sky-950/40"
        >
          <input
            type={kind === 'single_choice' ? 'radio' : 'checkbox'}
            name={`answer_${resultId}`}
            value={option.value}
            checked={selected.has(option.value)}
            disabled={off}
            required={kind === 'single_choice' && mandatory}
            onChange={(event) => toggle(option.value, event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-sky-600"
          />
          <span>
            <span className="mr-2 font-medium text-slate-500 dark:text-slate-400">
              {String.fromCharCode(65 + index)}.
            </span>
            {option.label}
          </span>
        </label>
      ))}
      <div className="flex items-start justify-between gap-2">
        {kind === 'multi_choice' ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_0ab7550e21edbf" />
          </p>
        ) : (
          <span />
        )}
        <SaveDot state={f.saveState} error={f.error} onRetry={f.retry} />
      </div>
    </fieldset>
  )
}
