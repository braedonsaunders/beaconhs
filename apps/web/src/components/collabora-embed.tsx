'use client'

// Inline Collabora editor (Impress for training decks, Writer for documents).
//
// - Fetches a WOPI session via the server action supplied by the host surface,
//   then — as WOPI mandates — form-POSTs the access token into the iframe.
// - Passes darkTheme so the editor follows the app's light/dark mode.
// - Shows the animated BeaconHS lighthouse splash over the frame until
//   Collabora reports Document_Loaded (its own spinner never shows).
// - Speaks Collabora's postMessage API (Host_PostmessageReady handshake) and
//   exposes an imperative handle for host features like the document AI
//   panel's insert-at-cursor.
//
// Remount with a fresh `key` when the backing attachment changes.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Presentation } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { LogoMark } from '@/components/brand-logo'

export type CollaboraSession =
  | { ok: true; actionUrl: string; accessToken: string; accessTokenTtl: number }
  | { ok: false; error: 'not_configured' | 'no_master' | 'unknown_target' }

export type CollaboraHandle = {
  /** Insert plain text at the current cursor position. */
  insertText: (text: string) => void
  /** Whether the document finished loading (postMessage channel live). */
  isLoaded: () => boolean
}

export const CollaboraEmbed = forwardRef<
  CollaboraHandle,
  {
    fetchSession: () => Promise<CollaboraSession>
    /** Unique name for the target iframe (e.g. the entity id). */
    frameName: string
    className?: string
  }
>(function CollaboraEmbed({ fetchSession, frameName, className }, ref) {
  const [session, setSession] = useState<CollaboraSession | null>(null)
  const [loaded, setLoaded] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const originRef = useRef<string>('')

  useEffect(() => {
    let cancelled = false
    fetchSession()
      .then((s) => {
        if (cancelled) return
        if (s.ok) {
          // Follow the app theme exactly — pass it explicitly rather than
          // letting Collabora guess from the browser preference.
          const dark = document.documentElement.classList.contains('dark')
          s = { ...s, actionUrl: `${s.actionUrl}&darkTheme=${dark ? 'true' : 'false'}` }
          originRef.current = new URL(s.actionUrl).origin
        }
        setSession(s)
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

  // Collabora postMessage channel: acknowledge readiness once the document is
  // loaded, and drop the splash. Fallback timer in case the channel is
  // unavailable (misconfigured PostMessageOrigin) so the frame never stays
  // covered forever.
  useEffect(() => {
    if (!session?.ok) return
    const onMessage = (e: MessageEvent) => {
      if (originRef.current && e.origin !== originRef.current) return
      let msg: { MessageId?: string; Values?: { Status?: string } }
      try {
        msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (msg?.MessageId === 'App_LoadingStatus' && msg.Values?.Status === 'Document_Loaded') {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ MessageId: 'Host_PostmessageReady', SendTime: Date.now(), Values: {} }),
          originRef.current || '*',
        )
        setLoaded(true)
      }
    }
    window.addEventListener('message', onMessage)
    const fallback = setTimeout(() => setLoaded(true), 45_000)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(fallback)
    }
  }, [session])

  useImperativeHandle(
    ref,
    () => ({
      isLoaded: () => loaded,
      insertText: (text: string) => {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({
            MessageId: 'Send_UNO_Command',
            SendTime: Date.now(),
            Values: {
              Command: '.uno:InsertText',
              Args: { Text: { type: 'string', value: text } },
            },
          }),
          originRef.current || '*',
        )
      },
    }),
    [loaded],
  )

  if (session && !session.ok) {
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
    <div className={cn('relative min-h-0', className)}>
      {session?.ok ? (
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
      ) : null}
      <iframe
        ref={iframeRef}
        name={`collabora-${frameName}`}
        title="Editor"
        className="h-full w-full bg-white dark:bg-slate-900"
        allow="clipboard-read *; clipboard-write *; fullscreen *"
        allowFullScreen
      />
      {!loaded ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-white dark:bg-slate-950">
          <div className="flex flex-col items-center gap-3">
            <LogoMark draw animated className="h-16 w-16" />
            <span className="text-xs text-slate-500 dark:text-slate-400">Opening the editor…</span>
          </div>
        </div>
      ) : null}
    </div>
  )
})
