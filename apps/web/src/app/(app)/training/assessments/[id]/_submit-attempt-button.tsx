'use client'

// Submit an assessment attempt. Grading finalizes the attempt, can issue a
// training record, and runs flows, so it needs signal: offline it explains
// instead, and online it first pushes any answers still queued on this device
// (the submission grades the saved answers).

import { useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { useOnlineAction } from '@/lib/offline-drafts/use-online-action'
import { toast } from '@/lib/toast'
import { submitAssessmentAttempt } from '../../_actions/assessments'

export function SubmitAttemptButton({ attemptId, graded }: { attemptId: string; graded: boolean }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const runOnline = useOnlineAction()
  const [pending, start] = useTransition()
  function submit() {
    start(async () => {
      await runOnline('finish', async () => {
        const result = await submitAssessmentAttempt(attemptId)
        if (!result.ok) toast.error(tGeneratedValue(result.error))
      })
    })
  }
  return (
    <Button type="button" onClick={submit} disabled={pending}>
      <GeneratedValue
        value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
      />
      <GeneratedValue value={graded ? 'Submit for grading' : 'Complete assessment'} />
    </Button>
  )
}
