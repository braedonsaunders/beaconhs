'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useGeneratedTranslations } from '@/i18n/generated'

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
  const tGenerated = useGeneratedTranslations()
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
          aria-label={tGenerated('m_02497d0c780d25')}
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
          aria-label={tGenerated('m_190b3fdf338cce')}
        />
        <GeneratedValue
          value={
            quiz ? (
              <span
                className={`mt-1 block text-[11px] ${
                  quiz.passed
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                <GeneratedText id="m_024d191d46cb91" />{' '}
                <GeneratedValue value={quiz.score != null ? `${quiz.score}%` : '—'} /> ·
                <GeneratedValue value={' '} />
                <GeneratedValue
                  value={
                    quiz.passed ? (
                      <GeneratedText id="m_024691de112e9e" />
                    ) : (
                      <GeneratedText id="m_18b5bac93bda7f" />
                    )
                  }
                />
              </span>
            ) : hasQuiz ? (
              <span className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_19b4822774cafa" />
              </span>
            ) : null
          }
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          name={`passed__${attendeeId}`}
          checked={passed}
          disabled={!attended}
          onChange={(event) => setPassed(event.currentTarget.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
          aria-label={tGenerated('m_10cad12b9fc18d')}
        />
      </td>
    </>
  )
}
