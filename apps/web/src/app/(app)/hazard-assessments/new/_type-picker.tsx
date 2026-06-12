'use client'

// Radio-card picker for the assessment type — the first decision on the new
// assessment form. Each card advertises which sections the type enables so
// crews can tell the assessment styles apart at a glance.

import { useState } from 'react'
import { cn } from '@beaconhs/ui'

export type TypeCard = {
  id: string
  name: string
  description: string | null
  style: 'task_based' | 'hazard_based'
  hasTasks: boolean
  hasHazards: boolean
  hasPPE: boolean
  hasQuestions: boolean
  hasWAH: boolean
}

function SectionChip({ label, tone }: { label: string; tone?: 'amber' | 'red' | 'sky' }) {
  const tones = {
    amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    red: 'bg-red-50 text-red-700 ring-red-600/20',
    sky: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    default:
      'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 ring-slate-500/10',
  }
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
        tones[tone ?? 'default'],
      )}
    >
      {label}
    </span>
  )
}

export function TypePicker({
  types,
  name,
  defaultValue,
}: {
  types: TypeCard[]
  name: string
  defaultValue?: string
}) {
  const [selected, setSelected] = useState<string>(defaultValue ?? '')

  return (
    <div>
      <input type="hidden" name={name} value={selected} required />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {types.map((t) => {
          const active = selected === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id)}
              aria-pressed={active}
              className={cn(
                'rounded-lg border p-3 text-left transition-all',
                active
                  ? 'border-teal-600 bg-teal-50/60 ring-2 ring-teal-600/30'
                  : 'border-slate-200 bg-white hover:border-teal-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-slate-900 dark:text-slate-100">{t.name}</div>
                <span
                  className={cn(
                    'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border',
                    active
                      ? 'border-teal-600 bg-teal-600'
                      : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900',
                  )}
                />
              </div>
              {t.description ? (
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{t.description}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                <SectionChip label={t.style === 'task_based' ? 'Task-based' : 'Hazard-based'} />
                {t.hasPPE ? <SectionChip label="PPE" /> : null}
                {t.hasQuestions ? <SectionChip label="Questions" /> : null}
                {t.hasTasks ? <SectionChip label="Tasks" /> : null}
                {t.hasHazards ? <SectionChip label="Hazards" /> : null}
                {t.hasWAH ? <SectionChip label="Heights" tone="sky" /> : null}
              </div>
            </button>
          )
        })}
      </div>
      {types.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
          No assessment types are available. Ask an administrator to create one under Manage →
          Assessment types.
        </p>
      ) : null}
    </div>
  )
}
