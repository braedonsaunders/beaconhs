'use client'

// Shared read-only PDF modal — opens a document's or book's PDF in an <iframe>
// on a URL resolved on demand. Used by both the documents and books read-only
// card grids. `resolve(id)` returns either a ready URL, a "still generating"
// signal, or an error.

import { useCallback, useEffect, useState } from 'react'
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
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    const r = await resolve(id)
    if (!r.ok) {
      setStatus('error')
      setError(r.error)
      return
    }
    if (r.url) {
      setUrl(r.url)
      setStatus('ready')
    } else {
      setStatus('generating')
    }
  }, [id, resolve])

  useEffect(() => {
    void load()
  }, [load])

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
            {url ? (
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
                Generating the PDF — this takes a few seconds.
              </p>
              <Button variant="outline" onClick={load}>
                <RefreshCw size={14} /> Check again
              </Button>
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
