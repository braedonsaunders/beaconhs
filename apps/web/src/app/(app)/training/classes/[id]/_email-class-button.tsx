'use client'

import { useState, useTransition } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { Mail } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { confirmDialog } from '@/lib/confirm'
import { flushRecordSaves } from '@/lib/pending-record-saves'
import { emailClass } from '../_actions'

export function EmailClassButton({ id }: { id: string }) {
  const t = useGeneratedValueTranslations()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  function send() {
    start(async () => {
      if (
        !(await confirmDialog({
          title: t('Email class'),
          message: t(
            'Confirm that the class details and employee roster are ready. This sends the enabled class email flows to their configured recipients.',
          ),
          confirmLabel: t('Email class'),
        }))
      )
        return
      setError(null)
      setQueued(false)
      try {
        await flushRecordSaves()
        const form = new FormData()
        form.set('id', id)
        const result = await emailClass(form)
        if (result.error) setError(result.error)
        else setQueued(true)
      } catch (error) {
        unstable_rethrow(error)
        setError(
          t('The class email could not be queued. Check that your changes saved and try again.'),
        )
      }
    })
  }
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={send}
        data-walkthrough="training-email-class"
      >
        <Mail size={14} />
        <GeneratedValue value={pending ? 'Queuing…' : 'Email class'} />
      </Button>
      {error ? (
        <p role="alert" className="mt-1 max-w-sm text-xs text-red-700 dark:text-red-300">
          <GeneratedValue value={error} />
        </p>
      ) : null}
      {queued ? (
        <p role="status" className="mt-1 text-xs text-teal-700 dark:text-teal-300">
          <GeneratedValue value="Class email queued." />
        </p>
      ) : null}
    </div>
  )
}
