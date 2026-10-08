'use client'

import { useState, useTransition, type ComponentType } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CircleDot, LoaderCircle } from 'lucide-react'
import { toast } from '@/lib/toast'
import type { FeedbackDialogProps } from './feedback-dialog'

export function FeedbackLauncher({ appVersion, locale }: { appVersion: string; locale: string }) {
  const t = useTranslations('Feedback')
  const common = useTranslations('Common')
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [Dialog, setDialog] = useState<ComponentType<FeedbackDialogProps> | null>(null)
  function launch() {
    if (Dialog) {
      setOpen(true)
      return
    }
    start(async () => {
      try {
        const { FeedbackDialog } = await import('./feedback-dialog')
        setDialog(() => FeedbackDialog)
        setOpen(true)
      } catch {
        toast.error(t('unavailableBody'))
      }
    })
  }
  return (
    <>
      <button
        type="button"
        onClick={launch}
        disabled={pending}
        aria-busy={pending}
        aria-label={pending ? common('loading') : t('reportIssue')}
        data-walkthrough="report-issue"
        className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        {pending ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <CircleDot className="h-4 w-4" />
        )}
      </button>
      {open && Dialog ? (
        <Dialog
          appVersion={appVersion}
          locale={locale}
          pathname={pathname}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
