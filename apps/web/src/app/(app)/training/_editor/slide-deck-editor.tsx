'use client'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

import { useGeneratedTranslations } from '@/i18n/generated'

// The slideshow deck workspace — Collabora Online is THE editor. Every
// editable deck is backed by one .pptx master (sourceAttachmentId). Editing
// and Present both run through Collabora; there is no PDF/image derivative.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileUp, Loader2, Play, Plus, X } from 'lucide-react'
import { Button, FileUploader, cn } from '@beaconhs/ui'
import { MAX_PPTX_FILE_BYTES } from '@beaconhs/office/limits'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { CollaboraEmbed } from '@/components/collabora-embed'
import {
  createBlankDeckMaster,
  getPptxAuthorPlaybackSession,
  getPptxEditorSession,
} from '../pptx/_actions'

export function SlideDeckEditor({
  onImportPptx,
  target,
  targetId,
  master,
  beforeDeckMutation,
  className,
}: {
  onImportPptx: (attachmentId: string) => Promise<void>
  target: 'lesson' | 'content_item'
  targetId: string
  /** The deck's PowerPoint master, when one exists. */
  master: { attachmentId: string; filename: string } | null
  beforeDeckMutation?: () => Promise<void>
  className?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [showImport, setShowImport] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [starting, startTransition] = useTransition()

  const downloadHref = `/training/pptx/${target}/${targetId}/download`

  async function startBlank() {
    if (!(await confirmDialog('Start a blank PowerPoint deck?'))) return
    startTransition(async () => {
      try {
        await beforeDeckMutation?.()
        await createBlankDeckMaster(target, targetId)
        router.refresh()
      } catch (err) {
        toast.error(
          tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_02d9d59d8cb7d7')),
        )
      }
    })
  }

  const importPanel = (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <FileUploader
        requestUploadAction={requestUpload}
        finalizeUploadAction={finalizeUpload}
        kind="document"
        accept=".pptx"
        maxSize={MAX_PPTX_FILE_BYTES}
        onUploaded={(f) => {
          setShowImport(false)
          void onImportPptx(f.attachmentId)
            .then(() => {
              toast.success(tGenerated('m_00b3bf0ec59360'))
              router.refresh()
            })
            .catch((error: unknown) => {
              toast.error(
                tGeneratedValue(
                  error instanceof Error ? error.message : tGenerated('m_130f6b46beb549'),
                ),
              )
            })
        }}
        label={tGenerated('m_1406533d6ede6d')}
        hint={tGeneratedValue(
          master ? tGenerated('m_0fd79d920e8ab5') : tGenerated('m_0c6fc67f98ade6'),
        )}
      />
    </div>
  )

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <GeneratedValue
        value={
          master ? (
            <>
              {/* toolbar */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                <span
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  title={tGeneratedValue(master.filename)}
                >
                  <FileUp size={11} />
                  <span className="max-w-[14rem] truncate">
                    <GeneratedValue value={master.filename} />
                  </span>
                </span>
                <Button asChild variant="outline" size="sm">
                  <a href={downloadHref}>
                    <Download size={13} /> <GeneratedText id="m_0fcb9c63d263d1" />
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowImport((v) => !v)}
                >
                  <FileUp size={13} /> <GeneratedText id="m_05b540acc16fd1" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPresenting(true)}
                >
                  <Play size={13} /> <GeneratedText id="m_1c855abf768e34" />
                </Button>
              </div>

              {/* editor — flush against the toolbar, no wasted chrome */}
              <div className="flex min-h-0 flex-1 flex-col">
                <GeneratedValue
                  value={
                    showImport ? (
                      <div className="p-3 pb-0">
                        <GeneratedValue value={importPanel} />
                      </div>
                    ) : null
                  }
                />
                <CollaboraEmbed
                  key={master.attachmentId}
                  frameName={targetId}
                  fetchSession={() => getPptxEditorSession(target, targetId)}
                  className="min-h-[26rem] flex-1"
                />
              </div>
            </>
          ) : (
            <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-2xl space-y-4 px-5 py-8">
                <div className="rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <GeneratedText id="m_0648b599acb822" />
                  </h3>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_01d8f317297f75" />
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={starting}
                      onClick={() => setShowImport((v) => !v)}
                    >
                      <FileUp size={13} /> <GeneratedText id="m_07e44e3c0bd608" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={starting}
                      onClick={startBlank}
                    >
                      <GeneratedValue
                        value={
                          starting ? (
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
                </div>
                <GeneratedValue value={showImport ? importPanel : null} />
              </div>
            </div>
          )
        }
      />

      {/* present overlay */}
      <GeneratedValue
        value={
          presenting ? (
            <div className="fixed inset-0 z-[70] flex flex-col bg-black">
              <button
                type="button"
                onClick={() => setPresenting(false)}
                aria-label={tGenerated('m_1b2a3bcd3f18e3')}
                className="absolute top-3 right-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <X size={18} />
              </button>
              <CollaboraEmbed
                mode="presentation"
                frameName={`present-${targetId}`}
                fetchSession={() => getPptxAuthorPlaybackSession(target, targetId)}
                className="min-h-0 flex-1"
              />
            </div>
          ) : null
        }
      />
    </div>
  )
}
