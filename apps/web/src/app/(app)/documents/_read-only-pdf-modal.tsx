'use client'

// Shared read-only PDF modal — opens a document's or book's PDF in an <iframe>
// on a URL resolved on demand. Used by both the documents and books read-only
// card grids. `resolve(id)` returns either a ready URL, a "still generating"
// signal, or an error.
//
// Two kinds of URL come back from resolve():
//   • A cross-origin presigned URL (uploaded-PDF documents) — handed straight to
//     the <iframe>, which browsers render natively.
//   • A same-origin on-demand render route (in-app HTML docs + books), e.g.
//     `/documents/:id/pdf`. The route blocks while the worker renders the PDF and
//     then streams it — OR returns a JSON error if the render fails/times out. We
//     fetch it so we can show a real "generating" state and surface that error,
//     instead of dropping a failing route into an <iframe> that just renders blank.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@beaconhs/ui'

export type PdfResolveResult = { ok: true; url?: string } | { ok: false; error: string }
export type PdfResolve = (id: string) => Promise<PdfResolveResult>

type Status = 'loading' | 'ready' | 'generating' | 'error'

export function ReadOnlyPdfModal({
  id,
  title,
  resolve,
  onClose,
}: {
  id: string
  title: string
  resolve: PdfResolve
  onClose: () => void
}) {
  const [status, setStatus] = useState<Status>('loading')
  // What the <iframe> shows + the download / open-in-new-tab links point at: an
  // object URL for fetched renders, or the presigned URL for uploaded PDFs.
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const revokeBlob = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
  }, [])

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    revokeBlob()
    setUrl(null)

    const r = await resolve(id)
    if (!r.ok) {
      setStatus('error')
      setError(r.error)
      return
    }
    if (!r.url) {
      setStatus('generating')
      return
    }

    // Cross-origin presigned URL (uploaded PDF) → render straight in the iframe.
    if (!r.url.startsWith('/')) {
      setUrl(r.url)
      setStatus('ready')
      return
    }

    // Same-origin on-demand render route → fetch so we surface render failures
    // and show real progress rather than a silently-blank iframe.
    setStatus('generating')
    try {
      const res = await fetch(r.url, { credentials: 'same-origin' })
      if (!res.ok) {
        let message = `The PDF could not be generated (HTTP ${res.status}).`
        try {
          const body = (await res.json()) as { error?: string }
          if (body?.error) message = body.error
        } catch {
          // non-JSON error body — keep the status-code message
        }
        setStatus('error')
        setError(message)
        return
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      blobUrlRef.current = objectUrl
      setUrl(objectUrl)
      setStatus('ready')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'The PDF could not be loaded.')
    }
  }, [id, resolve, revokeBlob])

  useEffect(() => {
    void load()
    return revokeBlob
  }, [load, revokeBlob])

  const linkCls =
    'inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60'

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[88vh] w-[min(1000px,95vw)] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {title}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {status === 'ready' && url ? (
              <>
                <a href={url} download className={linkCls}>
                  <Download size={13} /> Download
                </a>
                <a href={url} target="_blank" rel="noreferrer" className={linkCls}>
                  <ExternalLink size={13} /> New tab
                </a>
              </>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-slate-100 dark:bg-slate-950">
          {status === 'ready' && url ? (
            <iframe src={url} title={title} className="h-full w-full" />
          ) : status === 'generating' ? (
            <Centered>
              <Loader2 size={20} className="animate-spin text-teal-600" />
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Generating the PDF — this can take a few seconds.
              </p>
            </Centered>
          ) : status === 'error' ? (
            <Centered>
              <p className="text-sm text-rose-600">{error ?? 'Could not load the PDF.'}</p>
              <Button variant="outline" onClick={load}>
                <RefreshCw size={14} /> Retry
              </Button>
            </Centered>
          ) : (
            <Centered>
              <Loader2 size={20} className="animate-spin text-slate-400" />
            </Centered>
          )}
        </div>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  )
}
