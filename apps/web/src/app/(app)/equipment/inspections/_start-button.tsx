'use client'

import { GeneratedText } from '@/i18n/generated'

// Start a named inspection in one tap.
//
// When the schedule already says which check is due, asking the crew to pick
// the type again is a pointless second decision — this posts straight to the
// create action and the inspection opens in a flyout over the page they were
// already on.

import { useTransition } from 'react'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { Button, cn } from '@beaconhs/ui'
import { startEquipmentInspection } from './_actions'

export function StartInspectionButton({
  itemId,
  typeId,
  returnTo,
  tone = 'link',
  className,
}: {
  itemId: string
  typeId: string
  /** In-app path the inspection flyout should open over. */
  returnTo: string
  /** `link` sits inside a table row; `button` sits in a work-list card. */
  tone?: 'link' | 'button'
  className?: string
}) {
  const [pending, start] = useTransition()

  function onStart() {
    if (pending) return
    const fd = new FormData()
    fd.set('targetMode', 'registered')
    fd.set('equipmentItemId', itemId)
    fd.set('typeId', typeId)
    fd.set('returnTo', returnTo)
    start(async () => {
      await startEquipmentInspection(fd)
    })
  }

  if (tone === 'button') {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={onStart}
        disabled={pending}
        className={className}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}{' '}
        <GeneratedText id="m_144de7fabb13dc" />
      </Button>
    )
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={onStart}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline disabled:opacity-60 dark:text-teal-300',
        className,
      )}
    >
      {pending ? <Loader2 size={12} className="animate-spin" /> : null}
      <GeneratedText id="m_0de51911bb80e2" />
    </button>
  )
}
