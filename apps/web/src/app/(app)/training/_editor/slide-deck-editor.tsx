'use client'

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
        toast.error(err instanceof Error ? err.message : 'Could not create the deck')
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
              toast.success('PowerPoint imported')
              router.refresh()
            })
            .catch((error: unknown) => {
              toast.error(error instanceof Error ? error.message : 'Could not import PowerPoint')
            })
        }}
        label="Drop a .pptx or click to choose"
        hint={
          master
            ? 'Replaces the current PowerPoint file. Maximum 1 GB.'
            : 'PowerPoint features and speaker notes are preserved. Maximum 1 GB.'
        }
      />
    </div>
  )

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {master ? (
        <>
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title={master.filename}
            >
              <FileUp size={11} />
              <span className="max-w-[14rem] truncate">{master.filename}</span>
            </span>
            <Button asChild variant="outline" size="sm">
              <a href={downloadHref}>
                <Download size={13} /> Download
              </a>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowImport((v) => !v)}
            >
              <FileUp size={13} /> Replace
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPresenting(true)}>
              <Play size={13} /> Present
            </Button>
          </div>

          {/* editor — flush against the toolbar, no wasted chrome */}
          <div className="flex min-h-0 flex-1 flex-col">
            {showImport ? <div className="p-3 pb-0">{importPanel}</div> : null}
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
                New presentation
              </h3>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                Import a PowerPoint file or start a blank presentation.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={starting}
                  onClick={() => setShowImport((v) => !v)}
                >
                  <FileUp size={13} /> Import PowerPoint
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={starting}
                  onClick={startBlank}
                >
                  {starting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}{' '}
                  Start blank
                </Button>
              </div>
            </div>
            {showImport ? importPanel : null}
          </div>
        </div>
      )}

      {/* present overlay */}
      {presenting ? (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black">
          <button
            type="button"
            onClick={() => setPresenting(false)}
            aria-label="Close presentation"
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
      ) : null}
    </div>
  )
}
