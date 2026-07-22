'use client'

import { useState, useTransition } from 'react'
import { ClipboardCheck, Loader2, Search } from 'lucide-react'
import { Input, Label, cn } from '@beaconhs/ui'
import { PersonSelectField } from '@/components/person-select-field'
import { toast } from '@/lib/toast'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

type AssessmentType = {
  id: string
  name: string
  description: string | null
  passingScore: number
  graded: boolean
}
type PersonOption = { value: string; label: string; hint?: string }

export function NewTrainingAssessmentDrawer({
  types,
  people,
  defaultPersonId,
  complianceObligationId,
  startAction,
}: {
  types: AssessmentType[]
  people: PersonOption[]
  defaultPersonId?: string
  complianceObligationId?: string
  startAction: (formData: FormData) => Promise<void>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const [personId, setPersonId] = useState(defaultPersonId ?? '')
  const [query, setQuery] = useState('')
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const filtered = query.trim()
    ? types.filter((type) => {
        const value = query.trim().toLowerCase()
        return (
          type.name.toLowerCase().includes(value) ||
          (type.description ?? '').toLowerCase().includes(value)
        )
      })
    : types

  function create(typeId: string) {
    if (!personId) {
      toast.error(tGeneratedValue('Select the person taking this assessment.'))
      return
    }
    if (pending) return
    setPendingTypeId(typeId)
    const formData = new FormData()
    formData.set('typeId', typeId)
    formData.set('personId', personId)
    if (complianceObligationId) {
      formData.set('complianceObligationId', complianceObligationId)
    }
    start(async () => startAction(formData))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>
          <GeneratedValue value="Person" />
        </Label>
        <PersonSelectField
          name="personId"
          options={people}
          defaultValue={defaultPersonId}
          clearable={false}
          placeholder={tGeneratedValue('Select the person taking the assessment…')}
          onValueChange={setPersonId}
        />
      </div>
      {types.length > 6 ? (
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tGeneratedValue('Search assessment types…')}
            className="pl-9"
          />
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
          <GeneratedValue
            value={
              types.length === 0 ? 'No active assessment types are available.' : 'No types match.'
            }
          />
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((type) => {
            const isPending = pendingTypeId === type.id
            return (
              <li key={type.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => create(type.id)}
                  className={cn(
                    'group flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-teal-400 hover:shadow-sm disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700',
                    isPending && 'border-teal-500 ring-2 ring-teal-500/30',
                  )}
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                    {isPending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <ClipboardCheck size={16} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900 dark:text-slate-100">
                      {type.name}
                    </span>
                    {type.description ? (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">
                        {type.description}
                      </span>
                    ) : null}
                    <span className="mt-1.5 inline-flex rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-500/10 dark:bg-slate-800 dark:text-slate-400">
                      <GeneratedValue
                        value={
                          type.graded ? (
                            <>
                              <GeneratedValue value="Pass mark" /> {type.passingScore}%
                            </>
                          ) : (
                            'Completion only'
                          )
                        }
                      />
                    </span>
                  </span>
                  <span className="self-center text-xs font-medium text-teal-700 opacity-0 group-hover:opacity-100 dark:text-teal-400">
                    <GeneratedValue value={isPending ? 'Creating…' : 'Select'} />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
