'use client'

// Criteria-driven inspection form for the PPE record page.
//
// Behaviour (per spec):
//   - No "manual overall result" — the result is derived from the answers.
//   - Every criterion MUST be answered before the form can submit.
//   - A live Pass / Fail / Incomplete status shows as you go.
//
// The radios carry `name="criterion_<id>"` so the existing server action reads
// them straight from FormData; the controlled state drives the live status and
// the submit gate. High+ severity fails still auto-spawn a corrective action
// server-side.

import * as React from 'react'
import { Camera, CheckCircle2, CircleDashed, XCircle } from 'lucide-react'
import { Badge, Button, Input, Label, cn } from '@beaconhs/ui'

type Answer = 'pass' | 'fail' | 'n_a'
type Criterion = {
  id: string
  question: string
  description: string | null
  severity: 'low' | 'medium' | 'high' | 'critical'
  requiresPhoto: boolean
}

const ANSWERS: { value: Answer; label: string }[] = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'n_a', label: 'N/A' },
]

export function PpeInspectionForm({
  itemId,
  typeId,
  kind,
  criteria,
  action,
}: {
  itemId: string
  typeId: string
  kind: 'pre_use' | 'annual'
  criteria: Criterion[]
  action: (fd: FormData) => Promise<void>
}) {
  const [answers, setAnswers] = React.useState<Record<string, Answer>>({})

  const answeredCount = criteria.filter((c) => answers[c.id]).length
  const allAnswered = criteria.length > 0 && answeredCount === criteria.length
  const anyFail = criteria.some((c) => answers[c.id] === 'fail')
  const status: 'pass' | 'fail' | 'incomplete' = !allAnswered
    ? 'incomplete'
    : anyFail
      ? 'fail'
      : 'pass'

  const kindLabel = kind === 'annual' ? 'Annual' : 'Pre-use'

  return (
    <form action={action} className="flex h-full flex-col">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="typeId" value={typeId} />
      <input type="hidden" name="kind" value={kind} />

      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {kindLabel} criteria
            </p>
            <p className="text-xs text-slate-500">
              Answer every criterion. High+ severity failures auto-spawn a corrective action.
            </p>
          </div>
          <StatusBadge status={status} answered={answeredCount} total={criteria.length} />
        </div>

        <ul className="space-y-2">
          {criteria.map((c, i) => (
            <li
              key={c.id}
              className={cn(
                'rounded border bg-white p-3 dark:bg-slate-900',
                answers[c.id] === 'fail'
                  ? 'border-red-300 dark:border-red-900'
                  : 'border-slate-200 dark:border-slate-800',
              )}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                    <span className="text-slate-400">{i + 1}.</span>
                    <span className="flex-1">{c.question}</span>
                    {c.requiresPhoto ? (
                      <Badge variant="warning">
                        <Camera size={10} /> photo
                      </Badge>
                    ) : null}
                    <Badge
                      variant={
                        c.severity === 'critical' || c.severity === 'high'
                          ? 'destructive'
                          : c.severity === 'medium'
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      {c.severity}
                    </Badge>
                  </div>
                  {c.description ? (
                    <p className="mt-1 text-xs text-slate-500">{c.description}</p>
                  ) : null}
                  {c.requiresPhoto ? (
                    <div className="mt-2">
                      <Label className="text-xs text-slate-500">Attach photo evidence</Label>
                      <Input
                        type="file"
                        accept="image/*"
                        name={`photo_${c.id}`}
                        className="mt-1 text-xs"
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {ANSWERS.map((a) => {
                    const active = answers[c.id] === a.value
                    return (
                      <label
                        key={a.value}
                        className={cn(
                          'cursor-pointer rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                          active && a.value === 'pass'
                            ? 'border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
                            : active && a.value === 'fail'
                              ? 'border-red-400 bg-red-100 text-red-900 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200'
                              : active
                                ? 'border-slate-400 bg-slate-100 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
                                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
                        )}
                      >
                        <input
                          type="radio"
                          name={`criterion_${c.id}`}
                          value={a.value}
                          checked={active}
                          onChange={() => setAnswers((prev) => ({ ...prev, [c.id]: a.value }))}
                          className="sr-only"
                        />
                        {a.label}
                      </label>
                    )
                  })}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Input name="notes" placeholder="Anything to flag overall?" />
        </div>
      </div>

      <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <StatusBadge status={status} answered={answeredCount} total={criteria.length} />
        <Button type="submit" disabled={!allAnswered}>
          {status === 'fail' ? 'Record failed inspection' : 'Record inspection'}
        </Button>
      </div>
    </form>
  )
}

function StatusBadge({
  status,
  answered,
  total,
}: {
  status: 'pass' | 'fail' | 'incomplete'
  answered: number
  total: number
}) {
  if (status === 'incomplete') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <CircleDashed size={13} /> {answered} of {total} answered
      </span>
    )
  }
  if (status === 'fail') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300">
        <XCircle size={13} /> Fail
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
      <CheckCircle2 size={13} /> Pass
    </span>
  )
}
