'use client'

// Right-pane PDF surface with two modes:
//   • file-only documents — the uploaded PDF is the document; this pane is the
//     primary view (managers can upload/replace the source here).
//   • authored documents  — opening the pane generates a fresh PDF of the
//     CURRENT working draft (worker render of the DOCX master) with download
//     links. Readers always get the published version's PDF instead.
// Rendering uses the app-themed pdf.js viewer so the chrome follows the
// platform's light/dark theme.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ExternalLink, Loader2, RefreshCw, Upload } from 'lucide-react'
import { Button, FileUploader, cn } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { requestUpload, finalizeUpload } from '@/lib/uploads'
import { PdfViewer } from '@/components/pdf-viewer'
import { attachFileVersion, getDocumentPdfUrl } from './_actions'
import { ModeSwitch, type DocumentMode } from './_mode-switch'

export function DocumentPdfPane({
  documentId,
  mode,
  onModeChange,
  readOnly = false,
  draft = false,
}: {
  documentId: string
  mode?: DocumentMode
  onModeChange?: (m: DocumentMode) => void
  readOnly?: boolean
  /** Authored document, manage surface: render the CURRENT working draft. */
  draft?: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    const r = await getDocumentPdfUrl(documentId, { draft })
    if (!r.ok) {
      setStatus('error')
      setError(r.error)
      return
    }
    setUrl(r.url)
    setStatus('ready')
  }, [documentId, draft])

  useEffect(() => {
    void load()
  }, [load])

  function onUploaded(attachmentId: string) {
    setUploadOpen(false)
    void (async () => {
      const res = await attachFileVersion({ documentId, attachmentId })
      if (res.ok) {
        toast.success('PDF source updated.')
        await load()
        router.refresh()
      } else {
        toast.error(res.error ?? 'Upload failed')
      }
    })()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
        {!readOnly && mode && onModeChange ? (
          <ModeSwitch mode={mode} onChange={onModeChange} />
        ) : (
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Document</span>
        )}
        {draft && !readOnly ? (
          <span className="hidden text-[11px] text-slate-500 sm:inline dark:text-slate-400">
            Generated from the current draft
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          {draft && !readOnly ? (
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
            >
              <RefreshCw size={13} /> Regenerate
            </button>
          ) : null}
          {!readOnly && !draft ? (
            <button
              type="button"
              onClick={() => setUploadOpen((v) => !v)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
                uploadOpen
                  ? 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800/60 dark:bg-teal-950/50 dark:text-teal-300'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60',
              )}
            >
              <Upload size={13} /> Upload PDF
            </button>
          ) : null}
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
        </div>
      </div>

      {!readOnly && !draft && uploadOpen ? (
        <div className="border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <FileUploader
            requestUploadAction={requestUpload}
            finalizeUploadAction={finalizeUpload}
            kind="document"
            accept=".pdf"
            label="Drop a PDF here or click to choose — it becomes this document's source"
            onUploaded={(f) => onUploaded(f.attachmentId)}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {status === 'ready' && url ? (
          <PdfViewer url={url} className="h-full" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-600 dark:text-slate-300">
            {status === 'error' ? (
              <>
                <p className="text-rose-600 dark:text-rose-400">
                  {error ?? 'Could not load the PDF.'}
                </p>
                <Button variant="outline" onClick={load}>
                  <RefreshCw size={14} /> Retry
                </Button>
              </>
            ) : (
              <>
                <Loader2 size={20} className="animate-spin text-slate-400" />
                {draft && !readOnly ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Generating a PDF of the current draft…
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
