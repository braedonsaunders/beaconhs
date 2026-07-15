'use client'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

import { useGeneratedTranslations } from '@/i18n/generated'

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
type PdfResolve = (id: string) => Promise<PdfResolveResult>

type Status = 'loading' | 'ready' | 'generating' | 'error'
type PdfResource = {
  id: string
  status: Status
  url: string | null
  error: string | null
}
type ResolvedPdfResource = Omit<PdfResource, 'id'> & { blobUrl: boolean }

async function resolvePdfResource(id: string, resolve: PdfResolve): Promise<ResolvedPdfResource> {
  const result = await resolve(id)
  if (!result.ok) {
    return { status: 'error', url: null, error: result.error, blobUrl: false }
  }
  if (!result.url) {
    return { status: 'generating', url: null, error: null, blobUrl: false }
  }

  // Cross-origin presigned URL (uploaded PDF) → render straight in the iframe.
  if (!result.url.startsWith('/')) {
    return { status: 'ready', url: result.url, error: null, blobUrl: false }
  }

  // Same-origin on-demand render route → fetch so render failures are visible.
  try {
    const response = await fetch(result.url, { credentials: 'same-origin' })
    if (!response.ok) {
      let message = `The PDF could not be generated (HTTP ${response.status}).`
      try {
        const body = (await response.json()) as { error?: string }
        if (body?.error) message = body.error
      } catch {
        // Non-JSON error body — keep the status-code message.
      }
      return { status: 'error', url: null, error: message, blobUrl: false }
    }
    const blob = await response.blob()
    return { status: 'ready', url: URL.createObjectURL(blob), error: null, blobUrl: true }
  } catch (error) {
    return {
      status: 'error',
      url: null,
      error: error instanceof Error ? error.message : 'The PDF could not be loaded.',
      blobUrl: false,
    }
  }
}

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [resource, setResource] = useState<PdfResource>({
    id,
    status: 'loading',
    url: null,
    error: null,
  })
  // What the <iframe> shows + the download / open-in-new-tab links point at: an
  // object URL for fetched renders, or the presigned URL for uploaded PDFs.
  const blobUrlRef = useRef<string | null>(null)
  const requestSequence = useRef(0)

  const revokeBlob = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
  }, [])

  const applyResult = useCallback(
    (sequence: number, next: ResolvedPdfResource) => {
      if (sequence !== requestSequence.current) {
        if (next.blobUrl && next.url) URL.revokeObjectURL(next.url)
        return
      }
      if (next.blobUrl) blobUrlRef.current = next.url
      setResource({ id, status: next.status, url: next.url, error: next.error })
    },
    [id],
  )

  const requestPdf = useCallback(() => {
    const sequence = ++requestSequence.current
    revokeBlob()
    return resolvePdfResource(id, resolve).then((next) => applyResult(sequence, next))
  }, [applyResult, id, resolve, revokeBlob])

  useEffect(() => {
    void requestPdf()
    return () => {
      requestSequence.current += 1
      revokeBlob()
    }
  }, [requestPdf, revokeBlob])

  const current =
    resource.id === id
      ? resource
      : ({ id, status: 'loading', url: null, error: null } satisfies PdfResource)
  const { status, url, error } = current

  function retry() {
    revokeBlob()
    setResource({ id, status: 'loading', url: null, error: null })
    void requestPdf()
  }

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
            <GeneratedValue value={title} />
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <GeneratedValue
              value={
                status === 'ready' && url ? (
                  <>
                    <a href={url} download className={linkCls}>
                      <Download size={13} /> <GeneratedText id="m_0fcb9c63d263d1" />
                    </a>
                    <a href={url} target="_blank" rel="noreferrer" className={linkCls}>
                      <ExternalLink size={13} /> <GeneratedText id="m_10b8b9a1a3c87b" />
                    </a>
                  </>
                ) : null
              }
            />
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label={tGenerated('m_19ab80ae228d44')}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-slate-100 dark:bg-slate-950">
          <GeneratedValue
            value={
              status === 'ready' && url ? (
                <iframe src={url} title={tGeneratedValue(title)} className="h-full w-full" />
              ) : status === 'generating' ? (
                <Centered>
                  <Loader2 size={20} className="animate-spin text-teal-600" />
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    <GeneratedText id="m_1f9d74d7e4e09e" />
                  </p>
                </Centered>
              ) : status === 'error' ? (
                <Centered>
                  <p className="text-sm text-rose-600">
                    <GeneratedValue value={error ?? <GeneratedText id="m_18d93ca1591807" />} />
                  </p>
                  <Button variant="outline" onClick={retry}>
                    <RefreshCw size={14} /> <GeneratedText id="m_060f1ed88b3989" />
                  </Button>
                </Centered>
              ) : (
                <Centered>
                  <Loader2 size={20} className="animate-spin text-slate-400" />
                </Centered>
              )
            }
          />
        </div>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <GeneratedValue value={children} />
    </div>
  )
}
