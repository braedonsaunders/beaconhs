'use client'

// Right-pane PDF surface. Shows the document's PDF — either an uploaded source
// or one generated from the written content — and lets you upload/replace the
// PDF source. Carries the Write↔PDF switch in its header.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ExternalLink, Loader2, RefreshCw, Upload } from 'lucide-react'
import { Button, FileUploader, cn } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { requestUpload, finalizeUpload } from '@/lib/uploads'
import { attachFileVersion, getDocumentPdfUrl } from './_actions'
import { ModeSwitch, type DocumentMode } from './_mode-switch'

export function DocumentPdfPane({
  documentId,
  mode,
  onModeChange,
}: {
  documentId: string
  mode: DocumentMode
  onModeChange: (m: DocumentMode) => void
}) {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'ready' | 'generating' | 'error'>('loading')
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    const r = await getDocumentPdfUrl(documentId)
    if (!r.ok) {
      setStatus('error')
      setError(r.error)
      return
    }
    if ('url' in r) {
      setUrl(r.url)
      setStatus('ready')
    } else {
      setStatus('generating')
    }
  }, [documentId])

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
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3">
        <ModeSwitch mode={mode} onChange={onModeChange} />
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setUploadOpen((v) => !v)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
              uploadOpen
                ? 'border-teal-300 dark:border-teal-800/60 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60',
            )}
          >
            <Upload size={13} /> Upload PDF
          </button>
          {url ? (
            <>
              <a href={url} download className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-800 px-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <Download size={13} /> Download
              </a>
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-800 px-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <ExternalLink size={13} /> New tab
              </a>
            </>
          ) : null}
        </div>
      </div>

      {uploadOpen ? (
        <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
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
          <iframe src={url} title="Document PDF" className="h-full w-full" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-600 dark:text-slate-300">
            {status === 'error' ? (
              <>
                <p className="text-rose-600">{error ?? 'Could not load the PDF.'}</p>
                <Button variant="outline" onClick={load}>
                  <RefreshCw size={14} /> Retry
                </Button>
              </>
            ) : status === 'generating' ? (
              <>
                <Loader2 size={20} className="animate-spin text-teal-600" />
                <p>Generating the PDF from the document — this takes a few seconds.</p>
                <Button variant="outline" onClick={load}>
                  <RefreshCw size={14} /> Check again
                </Button>
              </>
            ) : (
              <Loader2 size={20} className="animate-spin text-slate-400" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
