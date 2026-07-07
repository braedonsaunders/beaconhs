'use client'

// The slideshow deck workspace — Collabora Online is THE editor. Every
// editable deck is backed by a .pptx master (sourceAttachmentId); slides[] is
// the derived render used by the player, thumbnails and Present. Decks
// without a master (new lessons, or decks built with the retired canvas
// tools) offer two starts: import a PowerPoint or begin a blank one — either
// becomes the master and replaces the rendered slides.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileUp, Loader2, Play, Plus, X } from 'lucide-react'
import { Button, FileUploader, cn } from '@beaconhs/ui'
import type { Slide } from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { SlidePlayer } from '../_components/slide-player'
import { CollaboraEmbed } from './collabora-embed'
import { createBlankDeckMaster } from '../pptx/_actions'

export function SlideDeckEditor({
  deck,
  attachmentUrls,
  importStatus,
  importError,
  onImportPptx,
  target,
  targetId,
  master,
  className,
}: {
  deck: Slide[]
  attachmentUrls: Record<string, string | null | undefined>
  importStatus: string | null
  importError: string | null
  onImportPptx: (attachmentId: string) => Promise<void>
  target: 'lesson' | 'content_item'
  targetId: string
  /** The deck's PowerPoint master, when one exists. */
  master: { attachmentId: string; filename: string } | null
  className?: string
}) {
  const router = useRouter()
  const [showImport, setShowImport] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [starting, startTransition] = useTransition()

  const importing = importStatus === 'pending' || importStatus === 'processing'
  const downloadHref = `/training/pptx/${target}/${targetId}/download`

  // Refresh while a render is in flight so the new slides (and a newly created
  // master) appear without a manual reload.
  useEffect(() => {
    if (!importing) return
    const t = setInterval(() => router.refresh(), 3500)
    return () => clearInterval(t)
  }, [importing, router])

  const statusBadge = importing ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
      <Loader2 size={11} className="animate-spin" /> rendering…
    </span>
  ) : importStatus === 'failed' ? (
    <span
      className="inline-flex max-w-[14rem] items-center truncate rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
      title={importError ?? undefined}
    >
      render failed
    </span>
  ) : null

  function startBlank() {
    if (
      deck.length > 0 &&
      !window.confirm('Start a blank PowerPoint deck? The current slides are replaced.')
    ) {
      return
    }
    startTransition(async () => {
      try {
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
        accept=".pptx,.ppt"
        onUploaded={(f) => {
          setShowImport(false)
          void onImportPptx(f.attachmentId).then(() => {
            toast.success('PowerPoint queued — slides appear when converted')
          })
        }}
        label="Drop a .pptx or click to choose"
        hint={
          master
            ? 'Replaces the current PowerPoint master and all slides.'
            : 'The file becomes this deck’s master copy. Speaker notes are preserved.'
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deck.length === 0}
              onClick={() => setPresenting(true)}
            >
              <Play size={13} /> Present
            </Button>
            {statusBadge}
          </div>

          {/* editor */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            {showImport ? importPanel : null}
            <CollaboraEmbed
              key={master.attachmentId}
              target={target}
              targetId={targetId}
              className="min-h-[26rem] flex-1"
            />
          </div>
        </>
      ) : (
        <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl space-y-4 px-5 py-8">
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {importing ? 'Preparing the deck…' : 'Slideshows are PowerPoint decks'}
              </h3>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                Import an existing .pptx or start blank — either way the file is edited right here
                and stays downloadable as PowerPoint.
              </p>
              {deck.length > 0 && !importing ? (
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                  This deck was built with the retired slide tools. It still plays, but editing
                  requires a PowerPoint master — importing or starting blank replaces the current
                  slides.
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={starting || importing}
                  onClick={() => setShowImport((v) => !v)}
                >
                  <FileUp size={13} /> Import PowerPoint
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={starting || importing}
                  onClick={startBlank}
                >
                  {starting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}{' '}
                  Start blank
                </Button>
                {deck.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPresenting(true)}
                  >
                    <Play size={13} /> Present
                  </Button>
                ) : null}
                {statusBadge}
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
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className="w-full max-w-[177.78vh]">
              <SlidePlayer slides={deck} attachmentUrls={attachmentUrls} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
