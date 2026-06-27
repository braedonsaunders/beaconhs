'use client'

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
  const [style, setStyle] = useState<Style>('task_based')

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input name="name" required placeholder="e.g. Standard hazard assessment" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea name="description" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Style</Label>
            <Select name="style" value={style} onChange={(e) => setStyle(e.target.value as Style)}>
              <option value="task_based">Task-based</option>
              <option value="hazard_based">Hazard-based</option>
            </Select>
          </div>
          {style === 'hazard_based' ? (
            <div className="space-y-1.5">
              <Label>Default hazard set</Label>
              <Select name="defaultHazardSetId" defaultValue="">
                <option value="">— none —</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <legend className="px-1 text-xs font-medium text-slate-500">Optional sections</legend>
            <CheckRow name="hasPPE" label="PPE" defaultChecked />
            <CheckRow name="hasQuestions" label="Questions & Answers" defaultChecked />
          </fieldset>
          {groups.length > 0 ? (
            <div className="space-y-1.5">
              <Label>Available to (person groups)</Label>
              <p className="text-xs text-slate-500">
                Leave empty to offer this type to everyone; pick groups to restrict who can start
                one.
              </p>
              <MultiPicker
                name="availableToGroupIds"
                options={groups.map((g) => ({ value: g.id, label: g.name }))}
              />
            </div>
          ) : null}
          <div className="flex items-center justify-end">
            <Button type="submit">Create type</Button>
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
      {label}
    </label>
  )
}
