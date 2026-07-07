'use client'

// Inline Collabora editor for a PowerPoint-mastered deck. Fetches a WOPI
// session (discovery URL + single-file token) via a server action, then — as
// WOPI mandates — form-POSTs the access token into the iframe. Remount with a
// fresh `key` when the master attachment changes (Replace / new deck).

import { useEffect, useRef, useState } from 'react'
import { Loader2, Presentation } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { getPptxEditorSession, type PptxEditorSession } from '../pptx/_actions'

export function CollaboraEmbed({
  target,
  targetId,
  className,
}: {
  target: 'lesson' | 'content_item'
  targetId: string
  className?: string
}) {
  const [session, setSession] = useState<PptxEditorSession | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    let cancelled = false
    getPptxEditorSession(target, targetId)
      .then((s) => {
        if (!cancelled) setSession(s)
      })
      .catch(() => {
        if (!cancelled) setSession({ ok: false, error: 'not_configured' })
      })
    return () => {
      cancelled = true
    }
  }, [target, targetId])

  useEffect(() => {
    if (session?.ok) formRef.current?.submit()
  }, [session])

  if (!session) {
    return (
      <div
        className={cn(
          'grid place-items-center rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
          className,
        )}
      >
        <span className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 size={15} className="animate-spin" /> Opening the editor…
        </span>
      </div>
    )
  }

  if (!session.ok) {
    return (
      <div
        className={cn(
          'grid place-items-center rounded-lg border border-amber-300 bg-amber-50 p-6 dark:border-amber-700 dark:bg-amber-950/40',
          className,
        )}
      >
        <div className="max-w-md text-center">
          <p className="flex items-center justify-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <Presentation size={15} />
            {session.error === 'not_configured'
              ? 'PowerPoint editing is not configured'
              : 'This deck has no PowerPoint file yet'}
          </p>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            {session.error === 'not_configured'
              ? 'The editor needs a Collabora Online server (COLLABORA_URL). The slideshow still plays from its last render, and the file can be downloaded.'
              : 'Import a PowerPoint or start a blank deck to begin.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('min-h-0', className)}>
      <form
        ref={formRef}
        action={session.actionUrl}
        method="POST"
        target={`collabora-${targetId}`}
        className="hidden"
      >
        <input type="hidden" name="access_token" value={session.accessToken} readOnly />
        <input
          type="hidden"
          name="access_token_ttl"
          value={String(session.accessTokenTtl)}
          readOnly
        />
      </form>
      <iframe
        name={`collabora-${targetId}`}
        title="PowerPoint editor"
        className="h-full w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        allow="clipboard-read *; clipboard-write *; fullscreen *"
        allowFullScreen
      />
    </div>
  )
}
