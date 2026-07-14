'use client'

import { useState } from 'react'
import { Input } from '@beaconhs/ui'

export function CompletionDecisionFields({
  attendeeId,
  initialAttended,
  initialPassed,
  initialGrade,
  quiz,
  hasQuiz,
}: {
  attendeeId: string
  initialAttended: boolean
  initialPassed: boolean
  initialGrade: number | null
  quiz: { score: number | null; passed: boolean } | null
  hasQuiz: boolean
}) {
  const [attended, setAttended] = useState(initialAttended)
  const [passed, setPassed] = useState(initialAttended && initialPassed)

  return (
    <>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          name={`attended__${attendeeId}`}
          checked={attended}
          onChange={(event) => {
            const next = event.currentTarget.checked
            setAttended(next)
            if (!next) setPassed(false)
          }}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
          aria-label="Attended"
        />
      </td>
      <td className="px-3 py-2">
        <Input
          name={`grade__${attendeeId}`}
          type="number"
          min="0"
          max="100"
          step="1"
          placeholder="—"
          defaultValue={initialGrade == null ? '' : String(initialGrade)}
          aria-label="Grade percentage"
        />
        {quiz ? (
          <span
            className={`mt-1 block text-[11px] ${
              quiz.passed
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            Quiz {quiz.score != null ? `${quiz.score}%` : '—'} ·{' '}
            {quiz.passed ? 'passed' : 'did not pass'}
          </span>
        ) : hasQuiz ? (
          <span className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500">
            No quiz attempt yet
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          name={`passed__${attendeeId}`}
          checked={passed}
          disabled={!attended}
          onChange={(event) => setPassed(event.currentTarget.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
          aria-label="Passed"
        />
      </td>
    </>
  )
}
