'use client'

// The right pane: a Write ↔ PDF surface. Write is the inline Collabora Writer
// on the document's DOCX master (page setup, comments and track changes live
// in the file) with a docked AI panel and a fullscreen mode; PDF renders the
// current draft for managers (file-only documents show their uploaded PDF as
// the primary view). Read-only users get the published PDF, nothing else.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Download,
  FileUp,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import { Button, FileUploader, Textarea, cn } from '@beaconhs/ui'
import { MAX_DOCX_CONVERSION_BYTES } from '@beaconhs/office/limits'
import { toast } from '@/lib/toast'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { MAX_DOCUMENT_VERSION_NOTE_CHARS } from '@/lib/document-authoring-policy'
import { CollaboraEmbed, type CollaboraHandle } from '@/components/collabora-embed'
import {
  createBlankDocumentMaster,
  getDocumentWriterSession,
  importDocumentMaster,
  publishDocumentVersion,
} from './_master-actions'
import { DocumentAiPanel } from './_ai-panel'
import { DocumentPdfPane } from './_pdf-pane'
import { ModeSwitch, type DocumentMode } from './_mode-switch'

export function DocumentPane({
  documentId,
  canManage,
  defaultMode,
  master,
  latestPublished,
  aiEnabled = false,
}: {
  documentId: string
  canManage: boolean
  defaultMode: DocumentMode
  /** The DOCX working master, when the document is authored in-app. */
  master: { attachmentId: string; filename: string } | null
  latestPublished: { version: number; renderStatus: string | null } | null
  aiEnabled?: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<DocumentMode>(defaultMode)
  const [fullscreen, setFullscreen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [showPublish, setShowPublish] = useState(false)
  const [changelog, setChangelog] = useState('')
  const [busy, startTransition] = useTransition()
  // Bumped when the AI agent rewrites the DOCX master behind the editor's
  // back — remounting the embed makes Writer load the new file.
  const [editorEpoch, setEditorEpoch] = useState(0)
  const editorRef = useRef<CollaboraHandle | null>(null)

  // Refresh while a published version's PDF is still rendering so the PDF
  // pane and version badges catch up without a manual reload.
  const rendering =
    latestPublished?.renderStatus === 'pending' || latestPublished?.renderStatus === 'processing'
  useEffect(() => {
    if (!rendering) return
    const t = setInterval(() => router.refresh(), 3500)
    return () => clearInterval(t)
  }, [rendering, router])

  function publish() {
    startTransition(async () => {
      try {
        await publishDocumentVersion(documentId, changelog)
        setShowPublish(false)
        setChangelog('')
        toast.success('Version published — the PDF renders in the background')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Publish failed')
      }
    })
  }

  function startBlank() {
    startTransition(async () => {
      try {
        await createBlankDocumentMaster(documentId)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not create the document')
      }
    })
  }

  const importPanel = (
    <div className="border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <FileUploader
        requestUploadAction={requestUpload}
        finalizeUploadAction={finalizeUpload}
        kind="document"
        accept=".docx"
        maxSize={MAX_DOCX_CONVERSION_BYTES}
        onUploaded={(f) => {
          setShowReplace(false)
          void importDocumentMaster(documentId, f.attachmentId)
            .then(() => {
              toast.success('Word file imported')
              router.refresh()
            })
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Import failed'))
        }}
        label="Drop a .docx or click to choose"
        hint={master ? 'Replaces the current working document. Maximum 100 MB.' : 'Maximum 100 MB.'}
      />
    </div>
  )

  let content: React.ReactNode
  if (!canManage) {
    content = <DocumentPdfPane documentId={documentId} readOnly />
  } else if (mode === 'pdf') {
    content = (
      <DocumentPdfPane
        documentId={documentId}
        mode={mode}
        onModeChange={setMode}
        draft={!!master}
      />
    )
  } else {
    content = (
      <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
          <ModeSwitch mode={mode} onChange={setMode} />
          {master ? (
            <span
              className="hidden min-w-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:inline-flex dark:bg-slate-800 dark:text-slate-300"
              title={master.filename}
            >
              <FileUp size={11} />
              <span className="max-w-[12rem] truncate">{master.filename}</span>
            </span>
          ) : null}
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {latestPublished ? `v${latestPublished.version} published` : 'Never published'}
          </span>
          {rendering ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
              <Loader2 size={11} className="animate-spin" /> rendering PDF…
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1.5">
            {master ? (
              <>
                {aiEnabled ? (
                  <Button
                    type="button"
                    variant={aiOpen ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAiOpen((v) => !v)}
                  >
                    <Sparkles size={13} /> AI
                  </Button>
                ) : null}
                <Button asChild variant="outline" size="sm">
                  <a href={`/documents/${documentId}/master`}>
                    <Download size={13} /> DOCX
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReplace((v) => !v)}
                >
                  <UploadCloud size={13} /> Replace
                </Button>
                <Button type="button" size="sm" onClick={() => setShowPublish((v) => !v)}>
                  Publish
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFullscreen((v) => !v)}
              aria-label="Toggle fullscreen"
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </Button>
          </div>
        </div>

        {showReplace ? importPanel : null}

        {showPublish && master ? (
          <div className="flex items-start gap-2 border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <Textarea
              rows={2}
              value={changelog}
              onChange={(e) => setChangelog(e.currentTarget.value)}
              maxLength={MAX_DOCUMENT_VERSION_NOTE_CHARS}
              placeholder="What changed in this version (optional)"
              className="flex-1"
            />
            <div className="flex shrink-0 flex-col gap-1.5">
              <Button type="button" size="sm" disabled={busy} onClick={publish}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : null} Publish v
                {(latestPublished?.version ?? 0) + 1}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowPublish(false)}>
                <X size={13} /> Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <div className={cn('flex min-h-0 flex-1', master ? '' : 'app-scroll overflow-y-auto')}>
          {master ? (
            <>
              <CollaboraEmbed
                key={`${master.attachmentId}:${editorEpoch}`}
                ref={editorRef}
                frameName={documentId}
                fetchSession={() => getDocumentWriterSession(documentId)}
                className="h-full min-w-0 flex-1"
              />
              {aiOpen && aiEnabled ? (
                <DocumentAiPanel
                  documentId={documentId}
                  editorRef={editorRef}
                  onClose={() => setAiOpen(false)}
                  onDocChanged={() => {
                    setEditorEpoch((v) => v + 1)
                    router.refresh()
                  }}
                  className="w-80 shrink-0"
                />
              ) : null}
            </>
          ) : (
            <div className="mx-auto w-full max-w-xl px-5 py-10">
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  New document
                </h3>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                  Import a Word file or start a blank document. Uploaded PDFs are managed from the
                  PDF tab.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => setShowReplace(true)}
                  >
                    <FileUp size={13} /> Import Word file
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={startBlank}
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}{' '}
                    Start blank
                  </Button>
                </div>
                {showReplace ? <div className="mt-3">{importPanel}</div> : null}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={
        fullscreen ? 'fixed inset-0 z-[80] bg-slate-100 dark:bg-slate-950' : 'h-full min-h-0'
      }
    >
      {content}
    </div>
  )
}
