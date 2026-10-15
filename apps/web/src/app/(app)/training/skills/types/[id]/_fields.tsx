'use client'

import { GeneratedText, GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'
import { LiveField, LiveSelect, LiveToggle, SaveDot } from '@/components/live-field'
import type { CredentialOutput } from '@/lib/credential-designs'
import { useRecordField } from '@/lib/offline-drafts/offline-record'

export function SkillTypeFields({
  type,
  outputs,
}: {
  type: {
    name: string
    code: string | null
    description: string | null
    validForMonths: number | null
    isActive: boolean
    viewSource: string
    credentialOutputIds: string[]
  }
  outputs: CredentialOutput[]
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-4">
      <LiveField field="name" label={tGenerated('m_02b18d5c7f6f2d')} initialValue={type.name} />
      <div className="grid grid-cols-2 gap-4">
        <LiveField field="code" label={tGenerated('m_0570e24c85cf95')} initialValue={type.code} />
        <LiveField
          field="validForMonths"
          label={tGenerated('m_01ba2e716aaea5')}
          type="number"
          initialValue={type.validForMonths?.toString() ?? ''}
        />
      </div>
      <LiveField
        field="description"
        label={tGenerated('m_14d923495cf14c')}
        multiline
        initialValue={type.description}
      />
      <LiveToggle
        field="isActive"
        label={tGenerated('m_1e1b1fdb7dd78e')}
        initialValue={type.isActive}
      />
      <LiveSelect
        field="viewSource"
        label={tGenerated('m_1f7272fb7b3683')}
        allowEmpty={false}
        initialValue={type.viewSource}
        options={[
          { value: 'evidence', label: 'Uploaded credential' },
          { value: 'generated', label: 'Generated credential' },
        ]}
      />
      <CredentialOutputsField initialValue={type.credentialOutputIds} outputs={outputs} />
    </div>
  )
}

/** The type's credential designs: a checkbox per enabled design, saved as one list. */
function CredentialOutputsField({
  initialValue,
  outputs,
}: {
  initialValue: string[]
  outputs: CredentialOutput[]
}) {
  const f = useRecordField<string[]>('credentialOutputIds', initialValue)
  const ids = f.value
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 flex w-full items-center justify-between gap-2 text-sm font-medium">
        <GeneratedText id="m_170ebf6987cd2e" />
        <SaveDot state={f.saveState} error={f.error} onRetry={f.retry} />
      </legend>
      {outputs.map((output) => (
        <label key={output.id} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
          <input
            type="checkbox"
            checked={ids.includes(output.id)}
            disabled={f.paused}
            className="h-4 w-4 accent-teal-600"
            onChange={(event) =>
              f.commit(
                event.target.checked ? [...ids, output.id] : ids.filter((id) => id !== output.id),
              )
            }
          />
          <GeneratedValue value={output.name} />
        </label>
      ))}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_08362a48f2ba06" />
      </p>
    </fieldset>
  )
}
