'use client'

// Structured slide editor — filmstrip + layout-template editing + PowerPoint
// import + Present overlay. Shared by studio lessons and library deck items.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Reorder } from 'framer-motion'
import { Copy, FileUp, Loader2, Play, Plus, Trash2, X } from 'lucide-react'
import { Button, FileUploader, Input, Label, Select, Textarea } from '@beaconhs/ui'
import type { Slide } from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { SlideThumb, SlideView } from '../../../_components/slide-view'
import { SlidePlayer } from '../../../_components/slide-player'
import { BlockEditor } from './_block-editor'

const LAYOUTS: { value: Slide['layout']; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'title-content', label: 'Title + content' },
  { value: 'two-col', label: 'Two columns' },
  { value: 'image-text', label: 'Image + text' },
  { value: 'image-full', label: 'Full image' },
]

const BGS: { value: NonNullable<Slide['bg']>; label: string; swatch: string }[] = [
  { value: 'white', label: 'White', swatch: 'bg-white border-slate-300' },
  { value: 'slate', label: 'Light', swatch: 'bg-slate-200 border-slate-300' },
  { value: 'teal', label: 'Teal', swatch: 'bg-teal-900 border-teal-900' },
  { value: 'dark', label: 'Dark', swatch: 'bg-slate-900 border-slate-900' },
]

const genId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s_${Math.random().toString(36).slice(2)}`

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
  const [deck, setDeck] = useState<Slide[]>(initialSlides ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(initialSlides?.[0]?.id ?? null)
  const [dirty, setDirty] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [pending, startTransition] = useTransition()
  // Local urls for images uploaded during this editing session (server map
  // refreshes after save/refresh).
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({})
  const urls = { ...attachmentUrls, ...localUrls }

  // A completed import re-renders the server component with fresh slides —
  // adopt them when we have no unsaved local edits.
  useEffect(() => {
    if (!dirty) {
      setDeck(initialSlides ?? [])
      setSelectedId((cur) => {
        if (cur && (initialSlides ?? []).some((s) => s.id === cur)) return cur
        return initialSlides?.[0]?.id ?? null
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlides])

  // Poll while an import is in flight so the new slides appear automatically.
  const importing = importStatus === 'pending' || importStatus === 'processing'
  useEffect(() => {
    if (!importing) return
    const t = setInterval(() => router.refresh(), 3500)
    return () => clearInterval(t)
  }, [importing, router])

  const selected = deck.find((s) => s.id === selectedId) ?? null

  function patchSelected(patch: Partial<Slide>) {
    if (!selectedId) return
    setDeck((prev) => prev.map((s) => (s.id === selectedId ? ({ ...s, ...patch } as Slide) : s)))
    setDirty(true)
  }
  function addSlide(layout: Slide['layout']) {
    const slide: Slide = { id: genId(), layout, bg: 'white' }
    setDeck((prev) => {
      const i = selectedId ? prev.findIndex((s) => s.id === selectedId) : prev.length - 1
      const next = [...prev]
      next.splice(i + 1, 0, slide)
      return next
    })
    setSelectedId(slide.id)
    setDirty(true)
  }
  function duplicateSelected() {
    if (!selected) return
    const copy: Slide = { ...selected, id: genId() }
    setDeck((prev) => {
      const i = prev.findIndex((s) => s.id === selected.id)
      const next = [...prev]
      next.splice(i + 1, 0, copy)
      return next
    })
    setSelectedId(copy.id)
    setDirty(true)
  }
  function deleteSelected() {
    if (!selected) return
    setDeck((prev) => {
      const i = prev.findIndex((s) => s.id === selected.id)
      const next = prev.filter((s) => s.id !== selected.id)
      setSelectedId(next[Math.min(i, next.length - 1)]?.id ?? null)
      return next
    })
    setDirty(true)
  }
  function save() {
    startTransition(async () => {
      await onSave(deck)
      setDirty(false)
      toast.success('Slides saved')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value=""
          onChange={(e) => {
            const v = e.currentTarget.value as Slide['layout'] | ''
            if (v) addSlide(v)
            e.currentTarget.value = ''
          }}
          className="h-8 w-44"
        >
          <option value="">+ Add slide…</option>
          {LAYOUTS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowImport((v) => !v)}>
          <FileUp size={14} /> Import PowerPoint
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPresenting(true)}
          disabled={deck.length === 0}
        >
          <Play size={14} /> Present
        </Button>
        {importing ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
            <Loader2 size={12} className="animate-spin" /> Importing slides…
          </span>
        ) : importStatus === 'failed' ? (
          <span
            className="inline-flex max-w-xs items-center gap-1.5 truncate rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700"
            title={importError ?? undefined}
          >
            Import failed — {importError ?? 'unknown error'}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {dirty ? <span className="text-xs text-amber-600">Unsaved changes</span> : null}
          <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Save slides
          </Button>
        </div>
      </div>

      {showImport ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <FileUploader
            requestUploadAction={requestUpload}
            finalizeUploadAction={finalizeUpload}
            kind="document"
            accept=".pptx,.ppt"
            onUploaded={(f) => {
              setShowImport(false)
              startTransition(async () => {
                await onImportPptx(f.attachmentId)
                toast.success('PowerPoint queued — slides will appear here when converted')
                router.refresh()
              })
            }}
            label="Drop a .pptx or click to choose"
            hint="Each slide becomes a pixel-perfect image (speaker notes preserved) appended to this deck."
          />
        </div>
      ) : null}

      {/* filmstrip + canvas */}
      <div className="flex gap-4">
        <div className="w-40 shrink-0">
          <Reorder.Group
            axis="y"
            values={deck}
            onReorder={(next) => {
              setDeck(next as Slide[])
              setDirty(true)
            }}
            as="ul"
            className="app-scroll max-h-[60vh] space-y-2 overflow-y-auto pr-1"
          >
            {deck.map((s, i) => (
              <Reorder.Item
                key={s.id}
                value={s}
                as="li"
                className="cursor-grab active:cursor-grabbing"
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`block w-full rounded-md p-0.5 text-left ${
                    s.id === selectedId
                      ? 'ring-2 ring-teal-500'
                      : 'hover:ring-2 hover:ring-slate-300'
                  }`}
                >
                  <SlideThumb slide={s} attachmentUrls={urls} />
                  <span className="mt-0.5 block px-1 text-[10px] text-slate-400 tabular-nums">
                    {i + 1}
                  </span>
                </button>
              </Reorder.Item>
            ))}
          </Reorder.Group>
          {deck.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">
              Add a slide or import a PowerPoint to begin.
            </p>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          {!selected ? (
            <div className="grid aspect-[16/9] place-items-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
              Select a slide to edit it.
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
                <SlideView slide={selected} attachmentUrls={urls} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selected.layout !== 'pptx' ? (
                  <Select
                    value={selected.layout}
                    onChange={(e) =>
                      patchSelected({ layout: e.currentTarget.value as Slide['layout'] })
                    }
                    className="h-8 w-40"
                  >
                    {LAYOUTS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    Imported PowerPoint slide
                  </span>
                )}
                {selected.layout !== 'pptx' && selected.layout !== 'image-full' ? (
                  <div className="flex items-center gap-1">
                    {BGS.map((b) => (
                      <button
                        key={b.value}
                        type="button"
                        title={b.label}
                        onClick={() => patchSelected({ bg: b.value })}
                        className={`h-6 w-6 rounded-full border ${b.swatch} ${
                          (selected.bg ?? 'white') === b.value
                            ? 'ring-2 ring-teal-500 ring-offset-1'
                            : ''
                        }`}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={duplicateSelected}>
                    <Copy size={14} /> Duplicate
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={deleteSelected}>
                    <Trash2 size={14} className="text-rose-500" /> Delete
                  </Button>
                </div>
              </div>

              {selected.layout !== 'pptx' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Title</Label>
                    <Input
                      value={selected.title ?? ''}
                      onChange={(e) => patchSelected({ title: e.currentTarget.value })}
                      placeholder="Slide title"
                    />
                  </div>
                  {selected.layout === 'title' || selected.layout === 'image-full' ? (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Subtitle</Label>
                      <Input
                        value={selected.subtitle ?? ''}
                        onChange={(e) => patchSelected({ subtitle: e.currentTarget.value })}
                        placeholder="Optional subtitle"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selected.layout === 'image-text' || selected.layout === 'image-full' ? (
                <div className="space-y-1.5">
                  <Label>Image</Label>
                  <FileUploader
                    requestUploadAction={requestUpload}
                    finalizeUploadAction={finalizeUpload}
                    kind="image"
                    accept=".png,.jpg,.jpeg,.gif,.webp"
                    onUploaded={(f) => {
                      patchSelected({ imageAttachmentId: f.attachmentId })
                      setLocalUrls((prev) => ({ ...prev, [f.attachmentId]: f.publicUrl }))
                    }}
                    label="Drop an image or click to choose"
                  />
                </div>
              ) : null}

              {selected.layout === 'title-content' || selected.layout === 'image-text' ? (
                <div className="space-y-1.5">
                  <Label>Content</Label>
                  <BlockEditor
                    key={`${selected.id}-body`}
                    inline
                    initialBlocks={Array.isArray(selected.body) ? selected.body : []}
                    onChange={(blocks) => patchSelected({ body: blocks })}
                  />
                </div>
              ) : null}

              {selected.layout === 'two-col' ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Left column</Label>
                    <BlockEditor
                      key={`${selected.id}-left`}
                      inline
                      initialBlocks={Array.isArray(selected.left) ? selected.left : []}
                      onChange={(blocks) => patchSelected({ left: blocks })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Right column</Label>
                    <BlockEditor
                      key={`${selected.id}-right`}
                      inline
                      initialBlocks={Array.isArray(selected.right) ? selected.right : []}
                      onChange={(blocks) => patchSelected({ right: blocks })}
                    />
                  </div>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label>Speaker / learner notes</Label>
                <Textarea
                  rows={2}
                  value={selected.notes ?? ''}
                  onChange={(e) => patchSelected({ notes: e.currentTarget.value })}
                  placeholder="Notes shown in the player's notes panel"
                />
              </div>
            </>
          )}
        </div>
      </div>

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
              <SlidePlayer slides={deck} attachmentUrls={urls} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
