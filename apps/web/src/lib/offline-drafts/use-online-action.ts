'use client'

// Run a step that needs a live connection — creating a record, uploading,
// submitting, locking, signing, or anything that runs flows — from a record
// page that otherwise works offline. Offline it explains instead of failing;
// online it first pushes every mounted record's queued edits (the submission
// barrier in lib/pending-record-saves.ts), so the step acts on the latest
// answers, and it never runs while those edits cannot be delivered.

import { useCallback } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'
import { flushRecordSaves } from '@/lib/pending-record-saves'
import { toast } from '@/lib/toast'

export type OnlineActionPurpose = 'start' | 'finish'

export function useOnlineAction() {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  return useCallback(
    async (purpose: OnlineActionPurpose, run: () => Promise<void>): Promise<boolean> => {
      if (!navigator.onLine) {
        toast.error(tGenerated(purpose === 'start' ? 'm_01fcca92411e7f' : 'm_1274068c9365ae'))
        return false
      }
      try {
        await flushRecordSaves()
      } catch (error) {
        toast.error(
          error instanceof Error ? tGeneratedValue(error.message) : tGenerated('m_00029353d2a87d'),
        )
        return false
      }
      try {
        await run()
        return true
      } catch (error) {
        unstable_rethrow(error)
        toast.error(tGenerated('m_02c49eab1c46fd'))
        return false
      }
    },
    [tGenerated, tGeneratedValue],
  )
}
