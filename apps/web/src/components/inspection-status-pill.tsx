import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Live "how far through am I" pill, shared by every inspection flyout (PPE and
// equipment) so the two read identically. It states the derived outcome once
// the checklist is complete, and what is still outstanding until then — the
// result is never picked by hand.

import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react'

export function InspectionStatusPill({
  status,
  answered,
  total,
  missingEvidence = 0,
  uploadingCount = 0,
}: {
  status: 'pass' | 'fail' | 'incomplete'
  answered: number
  total: number
  /** Answers that still owe a comment or photo. */
  missingEvidence?: number
  /** Photos mid-upload; submitting now would lose them. */
  uploadingCount?: number
}) {
  if (status === 'incomplete') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <CircleDashed size={13} />
        <GeneratedValue value={' '} />
        <GeneratedValue
          value={
            uploadingCount > 0 ? (
              <GeneratedText
                id="m_05040bfa089e75"
                values={{ value0: uploadingCount, value1: uploadingCount === 1 ? '' : 's' }}
              />
            ) : answered === total && missingEvidence > 0 ? (
              <GeneratedText
                id="m_0ad8b310bbb7d4"
                values={{ value0: missingEvidence, value1: missingEvidence === 1 ? '' : 's' }}
              />
            ) : (
              <GeneratedText id="m_1a4120b4c3f046" values={{ value0: answered, value1: total }} />
            )
          }
        />
      </span>
    )
  }
  if (status === 'fail') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300">
        <XCircle size={13} /> <GeneratedText id="m_169669494a86f8" />
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
      <CheckCircle2 size={13} /> <GeneratedText id="m_0e4b19568a01bf" />
    </span>
  )
}
