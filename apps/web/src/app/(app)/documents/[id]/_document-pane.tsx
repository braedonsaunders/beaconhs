'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
        const editor = editorRef.current
        if (!editor) throw new Error('Wait for the document editor to finish loading.')
        await editor.save()
        await publishDocumentVersion(documentId, changelog)
        setShowPublish(false)
        setChangelog('')
        toast.success(tGenerated('m_0af338262dbb88'))
        router.refresh()
      } catch (err) {
        toast.error(
          tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_01404a5cbe3992')),
        )
      }
    })
  }

  function startBlank() {
    startTransition(async () => {
      try {
        await createBlankDocumentMaster(documentId)
        router.refresh()
      } catch (err) {
        toast.error(
          tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_006a4dba30e7cf')),
        )
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
              toast.success(tGenerated('m_00f21769e3be7a'))
              router.refresh()
            })
            .catch((err) =>
              toast.error(
                tGeneratedValue(
                  err instanceof Error ? err.message : tGenerated('m_1cd7340b2d03df'),
                ),
              ),
            )
        }}
        label={tGenerated('m_16adf4c224e3a6')}
        hint={tGeneratedValue(
          master ? tGenerated('m_08e49c7718f2fe') : tGenerated('m_02e41dd22d52e7'),
        )}
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
          <GeneratedValue
            value={
              master ? (
                <span
                  className="hidden min-w-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:inline-flex dark:bg-slate-800 dark:text-slate-300"
                  title={tGeneratedValue(master.filename)}
                >
                  <FileUp size={11} />
                  <span className="max-w-[12rem] truncate">
                    <GeneratedValue value={master.filename} />
                  </span>
                </span>
              ) : null
            }
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            <GeneratedValue
              value={
                latestPublished ? (
                  <GeneratedText
                    id="m_08cb7e5d9ed635"
                    values={{ value0: latestPublished.version }}
                  />
                ) : (
                  <GeneratedText id="m_1fc55ca5a2b03f" />
                )
              }
            />
          </span>
          <GeneratedValue
            value={
              rendering ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                  <Loader2 size={11} className="animate-spin" />{' '}
                  <GeneratedText id="m_0ea5715ef19bd3" />
                </span>
              ) : null
            }
          />
          <div className="ml-auto flex items-center gap-1.5">
            <GeneratedValue
              value={
                master ? (
                  <>
                    <GeneratedValue
                      value={
                        aiEnabled ? (
                          <Button
                            type="button"
                            variant={aiOpen ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setAiOpen((v) => !v)}
                          >
                            <Sparkles size={13} /> <GeneratedText id="m_1e0a86199c09df" />
                          </Button>
                        ) : null
                      }
                    />
                    <Button asChild variant="outline" size="sm">
                      <a href={`/documents/${documentId}/master`}>
                        <Download size={13} /> <GeneratedText id="m_18c2e68821b0cd" />
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowReplace((v) => !v)}
                    >
                      <UploadCloud size={13} /> <GeneratedText id="m_05b540acc16fd1" />
                    </Button>
                    <Button type="button" size="sm" onClick={() => setShowPublish((v) => !v)}>
                      <GeneratedText id="m_0c072fb8baf115" />
                    </Button>
                  </>
                ) : null
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFullscreen((v) => !v)}
              aria-label={tGenerated('m_1090707d1671bd')}
            >
              <GeneratedValue
                value={fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              />
            </Button>
          </div>
        </div>

        <GeneratedValue value={showReplace ? importPanel : null} />

        <GeneratedValue
          value={
            showPublish && master ? (
              <div className="flex items-start gap-2 border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <Textarea
                  rows={2}
                  value={changelog}
                  onChange={(e) => setChangelog(e.currentTarget.value)}
                  maxLength={MAX_DOCUMENT_VERSION_NOTE_CHARS}
                  placeholder={tGenerated('m_1620b3eac618c8')}
                  className="flex-1"
                />
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button type="button" size="sm" disabled={busy} onClick={publish}>
                    <GeneratedValue
                      value={busy ? <Loader2 size={13} className="animate-spin" /> : null}
                    />{' '}
                    <GeneratedText id="m_01b66d9dba6889" />
                    <GeneratedValue value={(latestPublished?.version ?? 0) + 1} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPublish(false)}
                  >
                    <X size={13} /> <GeneratedText id="m_112e2e8ecda428" />
                  </Button>
                </div>
              </div>
            ) : null
          }
        />

        <div className={cn('flex min-h-0 flex-1', master ? '' : 'app-scroll overflow-y-auto')}>
          <GeneratedValue
            value={
              master ? (
                <>
                  <CollaboraEmbed
                    key={`${master.attachmentId}:${editorEpoch}`}
                    ref={editorRef}
                    frameName={documentId}
                    fetchSession={() => getDocumentWriterSession(documentId)}
                    className="h-full min-w-0 flex-1"
                  />
                  <GeneratedValue
                    value={
                      aiOpen && aiEnabled ? (
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
                      ) : null
                    }
                  />
                </>
              ) : (
                <div className="mx-auto w-full max-w-xl px-5 py-10">
                  <div className="rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <GeneratedText id="m_1c03b1cfc3b5e4" />
                    </h3>
                    <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_1c1501ca319466" />
                    </p>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => setShowReplace(true)}
                      >
                        <FileUp size={13} /> <GeneratedText id="m_08f83ac678024e" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={startBlank}
                      >
                        <GeneratedValue
                          value={
                            busy ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Plus size={13} />
                            )
                          }
                        />
                        <GeneratedValue value={' '} />
                        <GeneratedText id="m_1f809c4de18128" />
                      </Button>
                    </div>
                    <GeneratedValue
                      value={
                        showReplace ? (
                          <div className="mt-3">
                            <GeneratedValue value={importPanel} />
                          </div>
                        ) : null
                      }
                    />
                  </div>
                </div>
              )
            }
          />
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
      <GeneratedValue value={content} />
    </div>
  )
}
