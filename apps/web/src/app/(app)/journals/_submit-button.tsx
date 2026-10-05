'use client'

import { Loader2, Send } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { GeneratedValue } from '@/i18n/generated'

/** The same visible, touch-sized submit control for fresh and saved drafts. */
export function JournalSubmitButton({
  submitting,
  disabled = false,
  onClick,
}: {
  submitting: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      className="h-11 shrink-0"
      disabled={disabled || submitting}
      onClick={onClick}
      data-walkthrough="journals-submit"
    >
      {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
      <GeneratedValue value={submitting ? 'Submitting…' : 'Submit'} />
    </Button>
  )
}
