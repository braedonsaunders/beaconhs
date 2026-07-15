'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Right-pane PDF surface with two modes:
//   • file-only documents — the uploaded PDF is the document; this pane is the
//     primary view (managers can upload/replace the source here).
//   • authored documents  — opening the pane generates a fresh PDF of the
//     CURRENT working draft (worker render of the DOCX master) with download
//     links. Readers always get the published version's PDF instead.
// Rendering uses the app-themed pdf.js viewer so the chrome follows the
// platform's light/dark theme.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ExternalLink, Loader2, RefreshCw, UploadCloud } from 'lucide-react'
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const requestKey = `${documentId}:${draft ? 'draft' : 'published'}`
  const [resource, setResource] = useState<{
    key: string
    status: 'loading' | 'ready' | 'error'
    url: string | null
    error: string | null
    noSource: boolean
  }>({ key: requestKey, status: 'loading', url: null, error: null, noSource: false })
  const requestSequence = useRef(0)
  const [uploadOpen, setUploadOpen] = useState(false)

  const applyResult = useCallback(
    (sequence: number, r: Awaited<ReturnType<typeof getDocumentPdfUrl>>) => {
      if (sequence !== requestSequence.current) return
      if (!r.ok) {
        setResource({
          key: requestKey,
          status: 'error',
          url: null,
          error: r.error,
          noSource: r.reason === 'no_source',
        })
        return
      }
      setResource({
        key: requestKey,
        status: 'ready',
        url: r.url,
        error: null,
        noSource: false,
      })
    },
    [requestKey],
  )

  const requestPdf = useCallback(() => {
    const sequence = ++requestSequence.current
    return getDocumentPdfUrl(documentId, { draft }).then((result) => applyResult(sequence, result))
  }, [applyResult, documentId, draft])

  useEffect(() => {
    void requestPdf()
    return () => {
      requestSequence.current += 1
    }
  }, [requestPdf])

  const current =
    resource.key === requestKey
      ? resource
      : { key: requestKey, status: 'loading' as const, url: null, error: null, noSource: false }
  const { status, url, error, noSource } = current

  function reload() {
    setResource({
      key: requestKey,
      status: 'loading',
      url: null,
      error: null,
      noSource: false,
    })
    void requestPdf()
  }

  function onUploaded(attachmentId: string) {
    setUploadOpen(false)
    void (async () => {
      const res = await attachFileVersion({ documentId, attachmentId })
      if (res.ok) {
        toast.success(tGenerated('m_1151d7f1aaef1c'))
        await requestPdf()
        router.refresh()
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0d520cff4c0719')))
      }
    })()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
        <GeneratedValue
          value={
            !readOnly && mode && onModeChange ? (
              <ModeSwitch mode={mode} onChange={onModeChange} />
            ) : (
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                <GeneratedText id="m_18ce070374179f" />
              </span>
            )
          }
        />
        <GeneratedValue
          value={
            draft && !readOnly ? (
              <span className="hidden text-[11px] text-slate-500 sm:inline dark:text-slate-400">
                <GeneratedText id="m_0c75ff145748a1" />
              </span>
            ) : null
          }
        />
        <div className="ml-auto flex items-center gap-1.5">
          <GeneratedValue
            value={
              draft && !readOnly ? (
                <button
                  type="button"
                  onClick={reload}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
                >
                  <RefreshCw size={13} /> <GeneratedText id="m_0df0ba2bbd0a3e" />
                </button>
              ) : null
            }
          />
          <GeneratedValue
            value={
              !readOnly && !draft && url ? (
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
                  <UploadCloud size={13} /> <GeneratedText id="m_05b540acc16fd1" />
                </button>
              ) : null
            }
          />
          <GeneratedValue
            value={
              url ? (
                <>
                  <a
                    href={url}
                    download
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
                  >
                    <Download size={13} /> <GeneratedText id="m_0fcb9c63d263d1" />
                  </a>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
                  >
                    <ExternalLink size={13} /> <GeneratedText id="m_10b8b9a1a3c87b" />
                  </a>
                </>
              ) : null
            }
          />
        </div>
      </div>

      <GeneratedValue
        value={
          !readOnly && !draft && uploadOpen ? (
            <div className="border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <FileUploader
                requestUploadAction={requestUpload}
                finalizeUploadAction={finalizeUpload}
                kind="document"
                accept=".pdf"
                label={tGenerated('m_0e3b8a26b88d46')}
                onUploaded={(f) => onUploaded(f.attachmentId)}
              />
            </div>
          ) : null
        }
      />

      <div className={cn('min-h-0 flex-1', status !== 'ready' && 'app-scroll overflow-y-auto')}>
        <GeneratedValue
          value={
            status === 'ready' && url ? (
              <PdfViewer url={url} className="h-full" />
            ) : status === 'error' && noSource && !readOnly && !draft ? (
              // No PDF yet — the same centered card the Write tab uses for a new
              // document, with the uploader front and center.
              <div className="mx-auto w-full max-w-xl px-5 py-10">
                <div className="rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <GeneratedText id="m_0dc27d3fdd4051" />
                  </h3>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_1506c45e9a69f1" />
                  </p>
                  <div className="mt-4 text-left">
                    <FileUploader
                      requestUploadAction={requestUpload}
                      finalizeUploadAction={finalizeUpload}
                      kind="document"
                      accept=".pdf"
                      label={tGenerated('m_1aa3103f37882b')}
                      onUploaded={(f) => onUploaded(f.attachmentId)}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-600 dark:text-slate-300">
                <GeneratedValue
                  value={
                    status === 'error' ? (
                      <>
                        <p className={noSource ? '' : 'text-rose-600 dark:text-rose-400'}>
                          <GeneratedValue
                            value={error ?? <GeneratedText id="m_18d93ca1591807" />}
                          />
                        </p>
                        <Button variant="outline" onClick={reload}>
                          <RefreshCw size={14} /> <GeneratedText id="m_060f1ed88b3989" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Loader2 size={20} className="animate-spin text-slate-400" />
                        <GeneratedValue
                          value={
                            draft && !readOnly ? (
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                <GeneratedText id="m_10de289f7727be" />
                              </p>
                            ) : null
                          }
                        />
                      </>
                    )
                  }
                />
              </div>
            )
          }
        />
      </div>
    </div>
  )
}
