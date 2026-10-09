'use client'

import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'
import { useState } from 'react'
import { LiveField, LiveSelect, LiveToggle, useAutoSave } from '@/components/live-field'
import { Button } from '@beaconhs/ui'
import type { CredentialOutput } from '@/lib/credential-designs'
import { updateSkillTypeField } from '../_actions'

export function SkillTypeFields({
  type,
  outputs,
}: {
  type: {
    id: string
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

  const [ids, setIds] = useState(type.credentialOutputIds)
  const { state, save, retry } = useAutoSave({
    prepare: (value) => {
      const fd = new FormData()
      fd.set('id', type.id)
      fd.set('field', 'credentialOutputIds')
      fd.set('value', value)
      return fd
    },
    updateAction: updateSkillTypeField,
  })
  return (
    <div className="space-y-4">
      <LiveField
        id={type.id}
        field="name"
        label={tGenerated('m_02b18d5c7f6f2d')}
        initialValue={type.name}
        updateAction={updateSkillTypeField}
      />
      <div className="grid grid-cols-2 gap-4">
        <LiveField
          id={type.id}
          field="code"
          label={tGenerated('m_0570e24c85cf95')}
          initialValue={type.code}
          updateAction={updateSkillTypeField}
        />
        <LiveField
          id={type.id}
          field="validForMonths"
          label={tGenerated('m_01ba2e716aaea5')}
          type="number"
          initialValue={type.validForMonths?.toString() ?? ''}
          updateAction={updateSkillTypeField}
        />
      </div>
      <LiveField
        id={type.id}
        field="description"
        label={tGenerated('m_14d923495cf14c')}
        multiline
        initialValue={type.description}
        updateAction={updateSkillTypeField}
      />
      <LiveToggle
        id={type.id}
        field="isActive"
        label={tGenerated('m_1e1b1fdb7dd78e')}
        initialValue={type.isActive}
        updateAction={updateSkillTypeField}
      />
      <LiveSelect
        id={type.id}
        field="viewSource"
        label={tGenerated('m_1f7272fb7b3683')}
        allowEmpty={false}
        initialValue={type.viewSource}
        options={[
          { value: 'evidence', label: 'Uploaded credential' },
          { value: 'generated', label: 'Generated credential' },
        ]}
        updateAction={updateSkillTypeField}
      />
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">
          <GeneratedText id="m_170ebf6987cd2e" />
        </legend>
        {outputs.map((output) => (
          <label key={output.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ids.includes(output.id)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...ids, output.id]
                  : ids.filter((id) => id !== output.id)
                setIds(next)
                save(JSON.stringify(next))
              }}
            />
            {output.name}
          </label>
        ))}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_08362a48f2ba06" />
        </p>
        <span role="status" className="text-xs">
          {state === 'saving'
            ? tGenerated('m_106811f2aac664')
            : state === 'saved'
              ? tGenerated('m_0a0569b726b225')
              : ''}
        </span>
        {state === 'error' ? (
          <Button size="sm" variant="outline" onClick={retry}>
            <GeneratedText id="m_07b129acf56bac" />
          </Button>
        ) : null}
      </fieldset>
    </div>
  )
}
