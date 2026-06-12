'use client'

// Library deck editor — the Fabric slide editor (shared with the course
// builder's lesson surface) wrapped with explicit Save semantics for the
// Content Library item page. Legacy structured decks convert to canvas
// slides on open and persist as canvas on save.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import type { Slide } from '@beaconhs/db/schema'
import { toast } from '@/lib/toast'
import { SlideDeckEditor } from '../../../_editor/slide-deck-editor'
import { ensureCanvasDeck } from '../../../_editor/slide-model'

export function SlideEditor({
  initialSlides,
  attachmentUrls,
  importStatus,
  importError,
  onSave,
  onImportPptx,
}: {
  initialSlides: Slide[]
  attachmentUrls: Record<string, string | null | undefined>
  importStatus: string | null
  importError: string | null
  onSave: (slides: Slide[]) => Promise<void>
  onImportPptx: (attachmentId: string) => Promise<void>
}) {
  const router = useRouter()
  // Initialize raw (NOT converted): conversion needs DOMParser, which differs
  // between SSR and the browser — the effect below converts post-mount.
  const [deck, setDeck] = useState<Slide[]>(initialSlides ?? [])
  const [dirty, setDirty] = useState(false)
  const [pending, startTransition] = useTransition()

  // Convert legacy decks on mount; a completed import re-renders the server
  // component with fresh slides — adopt them when we have no unsaved edits.
  useEffect(() => {
    if (!dirty) setDeck(ensureCanvasDeck(initialSlides ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlides])

  // Poll while an import is in flight so the new slides appear automatically.
  const importing = importStatus === 'pending' || importStatus === 'processing'
  useEffect(() => {
    if (!importing) return
    const t = setInterval(() => router.refresh(), 3500)
    return () => clearInterval(t)
  }, [importing, router])

  function save() {
    startTransition(async () => {
      await onSave(deck)
      setDirty(false)
      toast.success('Slides saved')
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        <SlideDeckEditor
          deck={deck}
          onDeckChange={(next) => {
            setDeck(next)
            setDirty(true)
          }}
          attachmentUrls={attachmentUrls}
          importStatus={importStatus}
          importError={importError}
          onImportPptx={async (attachmentId) => {
            await onImportPptx(attachmentId)
            toast.success('PowerPoint queued — slides will appear here when converted')
            router.refresh()
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        {dirty ? <span className="text-xs text-amber-600">Unsaved changes</span> : null}
        <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
          {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          Save slides
        </Button>
      </div>
    </div>
  )
}
