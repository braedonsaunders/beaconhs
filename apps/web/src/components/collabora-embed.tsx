'use client'

// Inline Collabora editor (Impress for training decks, Writer for documents).
// Fetches a WOPI session (discovery URL + single-file token) via the server
// action supplied by the host surface, then — as WOPI mandates — form-POSTs
// the access token into the iframe. Remount with a fresh `key` when the
// backing attachment changes (Replace / new master / different version).

import { useEffect, useRef, useState } from 'react'
import { Loader2, Presentation } from 'lucide-react'
import { cn } from '@beaconhs/ui'

export type CollaboraSession =
  | { ok: true; actionUrl: string; accessToken: string; accessTokenTtl: number }
  | { ok: false; error: 'not_configured' | 'no_master' | 'unknown_target' }

export function CollaboraEmbed({
  fetchSession,
  frameName,
  className,
}: {
  fetchSession: () => Promise<CollaboraSession>
  /** Unique name for the target iframe (e.g. the entity id). */
  frameName: string
  className?: string
}) {
  const [session, setSession] = useState<CollaboraSession | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchSession()
      .then((s) => {
        if (!cancelled) setSession(s)
      })
      .catch(() => {
        if (!cancelled) setSession({ ok: false, error: 'not_configured' })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameName])

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
              ? 'In-browser editing is not configured'
              : 'This item has no source file yet'}
          </p>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            {session.error === 'not_configured'
              ? 'The editor needs a Collabora Online server (COLLABORA_URL). Published content and downloads keep working.'
              : 'Import a file or start a blank one to begin.'}
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
        target={`collabora-${frameName}`}
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
        name={`collabora-${frameName}`}
        title="Editor"
        className="h-full w-full bg-white dark:bg-slate-900"
        allow="clipboard-read *; clipboard-write *; fullscreen *"
        allowFullScreen
      />
    </div>
  )
}
