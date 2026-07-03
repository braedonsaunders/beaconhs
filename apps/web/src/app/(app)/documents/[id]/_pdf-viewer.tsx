'use client'

// Inline PDF viewer: a "PDF" button that opens a modal with the document's PDF
// in a native <iframe> on a presigned URL (browsers render PDFs natively — no
// pdf.js needed). Works for both generated PDFs and uploaded-PDF documents.

import { useCallback, useState } from 'react'
import { Download, ExternalLink, FileText, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { getDocumentPdfUrl } from './_actions'

type Status = 'idle' | 'loading' | 'ready' | 'error'

export function DocumentPdfButton({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    const r = await getDocumentPdfUrl(documentId)
    if (!r.ok) {
      setStatus('error')
      setError(r.error)
      return
    }
    setUrl(r.url)
    setStatus('ready')
  }, [documentId])

  function openViewer() {
    setOpen(true)
    void load()
  }

  return (
    <>
      <Button variant="outline" onClick={openViewer}>
        <FileText size={14} /> PDF
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-[85vh] w-[min(960px,94vw)] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Document PDF
              </span>
              <div className="flex items-center gap-1.5">
                {url ? (
                  <>
                    <a
                      href={url}
                      download
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
                    >
                      <Download size={13} /> Download
                    </a>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
                    >
                      <ExternalLink size={13} /> New tab
                    </a>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 bg-slate-100 dark:bg-slate-950">
              {status === 'ready' && url ? (
                <iframe src={url} title="Document PDF" className="h-full w-full" />
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
      ) : null}
    </>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  )
}
