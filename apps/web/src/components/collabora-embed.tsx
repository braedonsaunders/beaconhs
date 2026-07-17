'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Inline Collabora surface (editing, or native Impress presentation playback).
//
// - Fetches a WOPI session via the server action supplied by the host surface,
//   then — as WOPI mandates — form-POSTs the access token into the iframe.
// - Passes bhsTheme (our own param, enforced inside the frame by the mounted
//   branding.js) so the editor follows the app's light/dark mode. Collabora's
//   native darkTheme param is unusable: its mere presence forces dark mode
//   and clobbers ui_defaults, and COOL's per-browser saved theme would win
//   over it anyway.
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
import { useTheme } from '@/components/theme-provider'

export type CollaboraSession =
  | { ok: true; actionUrl: string; accessToken: string; accessTokenTtl: number }
  | {
      ok: false
      error:
        | 'not_configured'
        | 'no_master'
        | 'unknown_target'
        | 'workspace_unavailable'
        | 'impersonation_blocked'
        | 'access_denied'
    }

export type CollaboraHandle = {
  /** Insert plain text at the current cursor position. */
  insertText: (text: string) => void
  /** Flush pending editor changes through WOPI and wait for storage acknowledgment. */
  save: () => Promise<void>
  /** Whether the document finished loading (postMessage channel live). */
  isLoaded: () => boolean
}

export const CollaboraEmbed = forwardRef<
  CollaboraHandle,
  {
    fetchSession: () => Promise<CollaboraSession>
    /** Unique name for the target iframe (e.g. the entity id). */
    frameName: string
    mode?: 'editor' | 'presentation'
    className?: string
  }
>(function CollaboraEmbed({ fetchSession, frameName, mode = 'editor', className }, ref) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [session, setSession] = useState<CollaboraSession | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const originRef = useRef<string>('')
  const saveRequestRef = useRef<{
    resolve: () => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  } | null>(null)
  const fetchSessionRef = useRef(fetchSession)
  const { resolvedTheme } = useTheme()

  // Hosts pass small inline wrappers around server actions. Keep the current
  // wrapper available to retries without treating its render-time identity as
  // a new document session.
  useEffect(() => {
    fetchSessionRef.current = fetchSession
  }, [fetchSession])

  // In production Collabora is routed same-origin (/browser/*), so the frame
  // shares this page's localStorage. COOL resolves its theme from the
  // 'darkTheme' key (which beats every default) and live-updates on the
  // storage event — writing it here pins the editor to the app theme,
  // including live toggles, with no Collabora-side caching in the way.
  //
  // The storage event only re-themes COOL's CHROME in browsers — the core
  // (document canvas) activation is gated to the desktop apps, so a live
  // toggle would leave the document body on the boot theme. Send the same
  // UNO commands the in-editor dark-mode toggle uses so the canvas follows.
  const appliedThemeRef = useRef<string | null>(null)
  useEffect(() => {
    if (!session?.ok || !originRef.current) return
    if (originRef.current !== window.location.origin) return
    try {
      window.localStorage.setItem('darkTheme', resolvedTheme === 'dark' ? 'true' : 'false')
    } catch {
      /* storage unavailable — branding.js enforcement still applies */
    }
    const value = resolvedTheme === 'dark' ? 'Dark' : 'Light'
    if (!loaded) {
      // Boot picks the right theme up from localStorage — just record it.
      appliedThemeRef.current = value
      return
    }
    if (appliedThemeRef.current === value) return
    appliedThemeRef.current = value
    for (const command of ['.uno:ChangeTheme', '.uno:InvertBackground']) {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({
          MessageId: 'Send_UNO_Command',
          SendTime: Date.now(),
          Values: { Command: command, Args: { NewTheme: { type: 'string', value } } },
        }),
        originRef.current,
      )
    }
  }, [session, resolvedTheme, loaded])

  useEffect(() => {
    let cancelled = false
    setSession(null)
    setLoaded(false)
    fetchSessionRef
      .current()
      .then(async (s) => {
        if (cancelled) return
        if (s.ok) {
          // Follow the app theme exactly — branding.js inside the frame reads
          // this param and pins Collabora's theme to it.
          const dark = document.documentElement.classList.contains('dark')
          s = { ...s, actionUrl: `${s.actionUrl}&bhsTheme=${dark ? 'dark' : 'light'}` }
          const url = new URL(s.actionUrl)
          originRef.current = url.origin
          // Collabora serves branding.js with a months-long max-age keyed to
          // its build hash, so our branding updates never reach an already
          // visited browser on their own. When Collabora is routed
          // same-origin, refresh that exact cache entry once per tab session
          // before the frame requests it.
          if (url.origin === window.location.origin && !sessionStorage.getItem('bhs-brand-fresh')) {
            const brandingUrl = url.pathname.replace(/\/[^/]*$/, '/branding.js')
            await fetch(brandingUrl, { cache: 'reload' }).catch(() => {})
            try {
              sessionStorage.setItem('bhs-brand-fresh', '1')
            } catch {
              /* storage unavailable — refetch next mount instead */
            }
          }
          if (cancelled) return
        }
        setSession(s)
      })
      .catch(() => {
        if (!cancelled) setSession({ ok: false, error: 'not_configured' })
      })
    return () => {
      cancelled = true
    }
  }, [frameName, attempt])

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
      const editorWindow = iframeRef.current?.contentWindow
      if (
        !originRef.current ||
        !editorWindow ||
        e.origin !== originRef.current ||
        e.source !== editorWindow
      ) {
        return
      }
      let msg: {
        MessageId?: string
        Values?: { Status?: string; success?: boolean; result?: string; errorMsg?: string }
      }
      try {
        msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (msg?.MessageId === 'App_LoadingStatus' && msg.Values?.Status === 'Document_Loaded') {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ MessageId: 'Host_PostmessageReady', SendTime: Date.now(), Values: {} }),
          originRef.current,
        )
        setLoaded(true)
      }
      if (msg?.MessageId === 'Action_Save_Resp' && saveRequestRef.current) {
        const request = saveRequestRef.current
        saveRequestRef.current = null
        clearTimeout(request.timeout)
        if (msg.Values?.success === true || msg.Values?.result === 'unmodified') {
          request.resolve()
        } else {
          request.reject(
            new Error(
              msg.Values?.errorMsg || msg.Values?.result || 'The document could not be saved.',
            ),
          )
        }
      }
    }
    window.addEventListener('message', onMessage)
    const fallback = setTimeout(() => setLoaded(true), 45_000)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(fallback)
      if (saveRequestRef.current) {
        clearTimeout(saveRequestRef.current.timeout)
        saveRequestRef.current.reject(new Error('The editor closed before the document was saved.'))
        saveRequestRef.current = null
      }
    }
  }, [session])

  useImperativeHandle(
    ref,
    () => ({
      isLoaded: () => loaded,
      save: () => {
        if (!loaded || !originRef.current || !iframeRef.current?.contentWindow) {
          return Promise.reject(new Error('Wait for the document editor to finish loading.'))
        }
        if (saveRequestRef.current) {
          return Promise.reject(new Error('The document is already being saved.'))
        }
        return new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            saveRequestRef.current = null
            reject(new Error('The document save timed out. Try publishing again.'))
          }, 30_000)
          saveRequestRef.current = { resolve, reject, timeout }
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({
              MessageId: 'Action_Save',
              SendTime: Date.now(),
              Values: {
                DontTerminateEdit: true,
                DontSaveIfUnmodified: false,
                Notify: true,
              },
            }),
            originRef.current,
          )
        })
      },
      insertText: (text: string) => {
        if (!originRef.current) return
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({
            MessageId: 'Send_UNO_Command',
            SendTime: Date.now(),
            Values: {
              Command: '.uno:InsertText',
              Args: { Text: { type: 'string', value: text } },
            },
          }),
          originRef.current,
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
            <GeneratedValue
              value={
                session.error === 'not_configured' ? (
                  mode === 'presentation' ? (
                    <GeneratedText id="m_03b04f2c9a5b41" />
                  ) : (
                    <GeneratedText id="m_0784f424ad139f" />
                  )
                ) : session.error === 'workspace_unavailable' ? (
                  <GeneratedText id="m_054c1502bfc137" />
                ) : session.error === 'impersonation_blocked' ? (
                  <GeneratedText
                    id="m_18d4fc2d9e84b5"
                    values={{ value0: mode === 'presentation' ? 'Playback' : 'Editing' }}
                  />
                ) : session.error === 'access_denied' ? (
                  <GeneratedText id="m_138cb33820f2eb" />
                ) : (
                  <GeneratedText id="m_15869b49360768" />
                )
              }
            />
          </p>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            <GeneratedValue
              value={
                session.error === 'not_configured' ? (
                  mode === 'presentation' ? (
                    <GeneratedText id="m_00922c0e25fb4e" />
                  ) : (
                    <GeneratedText id="m_00f626c4fa0e34" />
                  )
                ) : session.error === 'workspace_unavailable' ? (
                  <GeneratedText
                    id="m_130320500eeb16"
                    values={{ value0: mode === 'presentation' ? 'the presentation' : 'the editor' }}
                  />
                ) : session.error === 'impersonation_blocked' ? (
                  <GeneratedText
                    id="m_0a947a2b31e38d"
                    values={{ value0: mode === 'presentation' ? 'the presentation' : 'the editor' }}
                  />
                ) : session.error === 'access_denied' ? (
                  <GeneratedText id="m_119df2fbc350ca" />
                ) : (
                  <GeneratedText id="m_190fd0f0f79fa2" />
                )
              }
            />
          </p>
          <GeneratedValue
            value={
              session.error === 'not_configured' ? (
                <button
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-400 px-3 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
                >
                  <GeneratedText id="m_060f1ed88b3989" />
                </button>
              ) : null
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative min-h-0', className)}>
      <GeneratedValue
        value={
          session?.ok ? (
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
          ) : null
        }
      />
      <iframe
        ref={iframeRef}
        name={`collabora-${frameName}`}
        title={tGeneratedValue(
          mode === 'presentation' ? tGenerated('m_0afabe08c69b48') : tGenerated('m_0030896e629200'),
        )}
        className="h-full w-full bg-white dark:bg-slate-900"
        allow="autoplay *; clipboard-read *; clipboard-write *; fullscreen *"
        allowFullScreen
      />
      <GeneratedValue
        value={
          !loaded ? (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white dark:bg-slate-950">
              <div className="flex flex-col items-center gap-3">
                <LogoMark draw animated className="h-16 w-16" />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedValue
                    value={
                      mode === 'presentation' ? (
                        <GeneratedText id="m_1d6945ff37b7bb" />
                      ) : (
                        <GeneratedText id="m_17d9ec9feb0904" />
                      )
                    }
                  />
                </span>
              </div>
            </div>
          ) : null
        }
      />
    </div>
  )
})
