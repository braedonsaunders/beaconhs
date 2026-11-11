'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// The right pane: a Write ↔ PDF surface. When a document is editable (draft or
// under review), Write opens Collabora Writer on the working DOCX master with
// AI and Publish controls, and PDF renders the current working draft. When a
// document is published or archived, PDF is the default and renders the exact
// published version of record, while Write opens that published snapshot
// read-only until a manager clicks Unpublish.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Download,
  FileUp,
  Loader2,
  Lock,
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
import {
  MAX_DOCUMENT_VERSION_NOTE_CHARS,
  nextDocumentMajorVersion,
} from '@/lib/document-authoring-policy'
import { CollaboraEmbed, type CollaboraHandle } from '@/components/collabora-embed'
import { DownloadLink } from '@/components/download-link'
import { useOnlineAction } from '@/lib/offline-drafts/use-online-action'
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
  canPublish,
  defaultMode,
  master,
  latestPublished,
  aiEnabled = false,
  pdfRevision,
}: {
  documentId: string
  canManage: boolean
  canPublish: boolean
  defaultMode: DocumentMode
  /** The DOCX working master, when the document is authored in-app. */
  master: { attachmentId: string; filename: string } | null
  latestPublished: {
    id: string
    version: number
    renderStatus: string | null
    docxAttachmentId: string | null
    docxFilename: string | null
  } | null
  aiEnabled?: boolean
  pdfRevision: string
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
  const previousDefaultMode = useRef(defaultMode)

  // Sync the active pane when Publish / Unpublish flips the document's
  // lifecycle state while the portal stays mounted in the layout.
  useEffect(() => {
    if (previousDefaultMode.current === defaultMode) return
    previousDefaultMode.current = defaultMode
    setMode(defaultMode)
    setAiOpen(false)
    setShowReplace(false)
    setShowPublish(false)
  }, [defaultMode])

  // Refresh while a published version's PDF is still rendering so the PDF
  // pane and version badges catch up without a manual reload.
  const rendering =
    latestPublished?.renderStatus === 'pending' || latestPublished?.renderStatus === 'processing'
  useEffect(() => {
    if (!rendering) return
    const t = setInterval(() => router.refresh(), 3500)
    return () => clearInterval(t)
  }, [rendering, router])

  // Publishing and starting a blank master need signal: offline they explain
  // instead of failing, and online they first push the Overview's queued
  // metadata so the published version carries it.
  const runOnline = useOnlineAction()

  function publish() {
    startTransition(async () => {
      await runOnline('finish', async () => {
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
    })
  }

  function startBlank() {
    startTransition(async () => {
      await runOnline('start', async () => {
        try {
          await createBlankDocumentMaster(documentId)
          router.refresh()
        } catch (err) {
          toast.error(
            tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_006a4dba30e7cf')),
          )
        }
      })
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

  const editableMaster = canPublish ? master : null
  const publishedDocx = !canPublish && latestPublished?.docxAttachmentId ? latestPublished : null
  const displayedFilename = editableMaster?.filename ?? publishedDocx?.docxFilename ?? null

  let content: React.ReactNode
  if (!canManage) {
    content = <DocumentPdfPane documentId={documentId} readOnly />
  } else if (mode === 'pdf') {
    content = (
      <DocumentPdfPane
        documentId={documentId}
        mode={mode}
        onModeChange={setMode}
        draft={canPublish && !!master}
        canReplace={canPublish}
        revision={pdfRevision}
      />
    )
  } else {
    content = (
      <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
          <ModeSwitch mode={mode} onChange={setMode} />
          <GeneratedValue
            value={
              displayedFilename ? (
                <span
                  className="hidden min-w-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:inline-flex dark:bg-slate-800 dark:text-slate-300"
                  title={tGeneratedValue(displayedFilename)}
                >
                  <FileUp size={11} />
                  <span className="max-w-[12rem] truncate">
                    <GeneratedValue value={displayedFilename} />
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
          {!canPublish ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <Lock size={11} />
              <GeneratedValue value="Read-only · click Unpublish to edit" />
            </span>
          ) : null}
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
                editableMaster ? (
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
                      <DownloadLink href={`/documents/${documentId}/master`}>
                        <Download size={13} /> <GeneratedText id="m_18c2e68821b0cd" />
                      </DownloadLink>
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
                ) : publishedDocx ? (
                  <Button asChild variant="outline" size="sm">
                    <DownloadLink
                      href={`/documents/${documentId}/versions/${publishedDocx.id}/download?kind=docx`}
                    >
                      <Download size={13} /> <GeneratedText id="m_18c2e68821b0cd" />
                    </DownloadLink>
                  </Button>
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

        <GeneratedValue value={canPublish && showReplace ? importPanel : null} />

        <GeneratedValue
          value={
            showPublish && editableMaster && canPublish ? (
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
                    <GeneratedValue value={nextDocumentMajorVersion(latestPublished?.version)} />
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

        <div
          className={cn(
            'flex min-h-0 flex-1',
            editableMaster || publishedDocx ? '' : 'app-scroll overflow-y-auto',
          )}
        >
          <GeneratedValue
            value={
              editableMaster ? (
                <>
                  <CollaboraEmbed
                    key={`${editableMaster.attachmentId}:${editorEpoch}`}
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
              ) : publishedDocx ? (
                <CollaboraEmbed
                  key={`published:${publishedDocx.id}`}
                  frameName={`${documentId}:${publishedDocx.id}`}
                  fetchSession={() => getDocumentWriterSession(documentId, publishedDocx.id)}
                  className="h-full min-w-0 flex-1"
                />
              ) : !canPublish ? (
                <div className="mx-auto w-full max-w-xl px-5 py-10">
                  <div className="rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <GeneratedValue value="Published PDF document" />
                    </h3>
                    <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                      <GeneratedValue value="This document is published from an uploaded PDF. Switch to PDF to read it, or click Unpublish at the top of the page before uploading a revised version." />
                    </p>
                  </div>
                </div>
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
