'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

import { useState } from 'react'
import { Button, Card, CardContent, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { MultiPicker } from '../../_multipicker'

type Style = 'task_based' | 'hazard_based'
type Ref = { id: string; name: string }

export function NewAssessmentTypeForm({
  sets,
  groups,
  action,
}: {
  sets: Ref[]
  groups: Ref[]
  action: (formData: FormData) => void | Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
  const [style, setStyle] = useState<Style>('task_based')

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_1a9978900838e6" />
            </Label>
            <Input name="name" required placeholder={tGenerated('m_0b0658ec2d4c22')} />
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_14d923495cf14c" />
            </Label>
            <Textarea name="description" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_03cf3a97d03fef" />
            </Label>
            <Select name="style" value={style} onChange={(e) => setStyle(e.target.value as Style)}>
              <option value="task_based">{'Task-based'}</option>
              <option value="hazard_based">{'Hazard-based'}</option>
            </Select>
          </div>
          <GeneratedValue
            value={
              style === 'hazard_based' ? (
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_14b0cc3abaca8d" />
                  </Label>
                  <Select name="defaultHazardSetId" defaultValue="">
                    <option value="">{'— none —'}</option>
                    {sets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null
            }
          />
          <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <legend className="px-1 text-xs font-medium text-slate-500">
              <GeneratedText id="m_0715227000cfd5" />
            </legend>
            <CheckRow name="hasPPE" label={tGenerated('m_18391e161b9ed6')} defaultChecked />
            <CheckRow name="hasQuestions" label={tGenerated('m_049fefa2074149')} defaultChecked />
          </fieldset>
          <GeneratedValue
            value={
              groups.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_05d7dad9d61d38" />
                  </Label>
                  <p className="text-xs text-slate-500">
                    <GeneratedText id="m_05b6b53cd5c67a" />
                  </p>
                  <MultiPicker
                    name="availableToGroupIds"
                    options={groups.map((g) => ({ value: g.id, label: g.name }))}
                  />
                </div>
              ) : null
            }
          />
          <div className="flex items-center justify-end">
            <Button type="submit">
              <GeneratedText id="m_043fe9fe859dff" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function CheckRow({
  name,
  label,
  defaultChecked,
}: {
  name: string
  label: string
  defaultChecked?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
      />
      <GeneratedValue value={label} />
    </label>
  )
}
