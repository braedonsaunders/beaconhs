'use client'

// The full Fabric slideshow editor — ribbon, filmstrip, canvas stage, speaker
// notes, PowerPoint import and Present overlay. Controlled: the parent owns
// the deck (autosave in the lesson surface, explicit Save in the library).
// Legacy structured slides must be converted via ensureCanvasDeck before they
// reach this component.
//
// PPTX-mastered decks (`master` set): the uploaded PowerPoint is the source of
// truth and slides[] is a derived render, so the canvas tools give way to a
// read-only viewer with Edit in PowerPoint (Collabora), Download and Detach.

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Reorder } from 'framer-motion'
import { Copy, Download, FileUp, Loader2, Pencil, Play, Trash2, Unlink, X } from 'lucide-react'
import { Button, FileUploader, Select, Textarea, cn } from '@beaconhs/ui'
import type { Slide, SlideElement } from '@beaconhs/db/schema'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { SlideThumb, SlideView } from '../_components/slide-view'
import { SlidePlayer } from '../_components/slide-player'
import { SlideCanvasEditor, type SlideCanvasHandle } from './slide-canvas'
import { SlideRibbon, ColorPicker } from './slide-ribbon'
import {
  SLIDE_TEMPLATES,
  createCanvasSlide,
  genElementId,
  newImageElement,
  type SlideTemplate,
} from './slide-model'

const SLIDE_BG_COLORS = [
  '#ffffff',
  '#f1f5f9',
  '#fef9c3',
  '#ccfbf1',
  '#134e4a',
  '#1e3a5f',
  '#0f172a',
]

const genSlideId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s_${Math.random().toString(36).slice(2)}`

export function SlideDeckEditor({
  deck,
  onDeckChange,
  attachmentUrls,
  importStatus,
  importError,
  onImportPptx,
  master,
  onDetach,
  className,
}: {
  deck: Slide[]
  onDeckChange: (deck: Slide[]) => void
  attachmentUrls: Record<string, string | null | undefined>
  importStatus: string | null
  importError: string | null
  onImportPptx: (attachmentId: string) => Promise<void>
  /** Set when the deck has a PowerPoint master copy — switches to master mode. */
  master?: { editHref: string; downloadHref: string; filename: string } | null
  onDetach?: () => Promise<void>
  className?: string
}) {
  const [selectedId, setSelectedId] = useState<string | null>(deck[0]?.id ?? null)
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([])
  const [showImport, setShowImport] = useState(false)
  const [presenting, setPresenting] = useState(false)
  // Images uploaded this session — server map refreshes after save.
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({})
  const urls = { ...attachmentUrls, ...localUrls }

  const canvasApi = useRef<SlideCanvasHandle | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const imageTargetRef = useRef<'insert' | { elementId: string }>('insert')
  const [imageBusy, setImageBusy] = useState(false)

  const selected = deck.find((s) => s.id === selectedId) ?? (deck.length ? deck[0]! : null)
  const selectedElements = (selected?.elements ?? []).filter((e) =>
    selectedElementIds.includes(e.id),
  )
  const importing = importStatus === 'pending' || importStatus === 'processing'
  const mastered = !!master

  const importBadge = importing ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
      <Loader2 size={11} className="animate-spin" /> {mastered ? 'rendering…' : 'importing…'}
    </span>
  ) : importStatus === 'failed' ? (
    <span
      className="inline-flex max-w-[14rem] items-center truncate rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
      title={importError ?? undefined}
    >
      {mastered ? 'render failed' : 'import failed'}
    </span>
  ) : null

  function patchSlide(id: string, patch: Partial<Slide>) {
    onDeckChange(deck.map((s) => (s.id === id ? ({ ...s, ...patch } as Slide) : s)))
  }
  function selectSlide(id: string | null) {
    setSelectedId(id)
    setSelectedElementIds([])
  }
  function addSlide(template: SlideTemplate) {
    const slide = createCanvasSlide(template, genSlideId())
    const i = selected ? deck.findIndex((s) => s.id === selected.id) : deck.length - 1
    const next = [...deck]
    next.splice(i + 1, 0, slide)
    onDeckChange(next)
    selectSlide(slide.id)
  }
  function duplicateSlide() {
    if (!selected) return
    const copy: Slide = {
      ...structuredClone(selected),
      id: genSlideId(),
      elements: (selected.elements ?? []).map((e) => ({
        ...structuredClone(e),
        id: genElementId(),
      })),
    }
    const i = deck.findIndex((s) => s.id === selected.id)
    const next = [...deck]
    next.splice(i + 1, 0, copy)
    onDeckChange(next)
    selectSlide(copy.id)
  }
  function deleteSlide() {
    if (!selected) return
    const i = deck.findIndex((s) => s.id === selected.id)
    const next = deck.filter((s) => s.id !== selected.id)
    onDeckChange(next)
    selectSlide(next[Math.min(i, next.length - 1)]?.id ?? null)
  }

  function openImagePicker(target: 'insert' | { elementId: string }) {
    imageTargetRef.current = target
    imageInputRef.current?.click()
  }

  async function handleImageFile(file: File) {
    setImageBusy(true)
    try {
      const req = await requestUpload({
        kind: 'image',
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      })
      if (!req.ok) throw new Error(req.error)
      await fetch(req.putUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      const fin = await finalizeUpload({
        key: req.key,
        kind: 'image',
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      })
      if (!fin.ok) throw new Error(fin.error)
      setLocalUrls((prev) => ({ ...prev, [fin.attachmentId]: req.publicUrl }))
      const target = imageTargetRef.current
      if (target === 'insert') {
        const natural = await new Promise<{ width: number; height: number } | null>((resolve) => {
          const probe = new window.Image()
          probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
          probe.onerror = () => resolve(null)
          probe.src = req.publicUrl
        })
        canvasApi.current?.addElement(newImageElement(fin.attachmentId, natural))
      } else if (selected) {
        const elements: SlideElement[] = (selected.elements ?? []).map((e) =>
          e.id === target.elementId && e.kind === 'image'
            ? { ...e, attachmentId: fin.attachmentId, url: undefined }
            : e,
        )
        patchSlide(selected.id, { elements })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Image upload failed')
    } finally {
      setImageBusy(false)
    }
  }

  function setImageFit(fit: 'stretch' | 'cover' | 'contain') {
    if (!selected) return
    const ids = new Set(selectedElementIds)
    patchSlide(selected.id, {
      elements: (selected.elements ?? []).map((e) =>
        ids.has(e.id) && e.kind === 'image' ? { ...e, fit } : e,
      ),
    })
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(ev) => {
          const file = ev.currentTarget.files?.[0]
          ev.currentTarget.value = ''
          if (file) void handleImageFile(file)
        }}
      />

      {mastered && master ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <span
            className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            title={master.filename}
          >
            <FileUp size={11} />
            <span className="max-w-[14rem] truncate">{master.filename}</span>
          </span>
          <Button asChild size="sm">
            <Link href={master.editHref}>
              <Pencil size={13} /> Edit in PowerPoint
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={master.downloadHref}>
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
          {onDetach ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (
                  !window.confirm(
                    'Detach this deck from its PowerPoint master? The current slides are kept and become editable here. Saves in the PowerPoint editor will no longer update this deck.',
                  )
                )
                  return
                void onDetach()
              }}
            >
              <Unlink size={13} /> Detach
            </Button>
          ) : null}
          {importBadge}
        </div>
      ) : (
        <SlideRibbon
          api={canvasApi}
          selection={selectedElements}
          disabled={!selected}
          onInsertImage={() => openImagePicker('insert')}
          onReplaceImage={() => {
            const img = selectedElements.find((e) => e.kind === 'image')
            if (img) openImagePicker({ elementId: img.id })
          }}
          onImageFit={setImageFit}
        >
          <Select
            value=""
            title="Add slide"
            onChange={(e) => {
              const v = e.currentTarget.value as SlideTemplate | ''
              if (v) addSlide(v)
              e.currentTarget.value = ''
            }}
            className="h-7 w-32 px-1.5 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <option value="">+ Add slide…</option>
            {SLIDE_TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          {selected ? (
            <ColorPicker
              label="Slide background"
              icon={<span className="text-[10px] font-semibold">BG</span>}
              value={selected.bgColor ?? '#ffffff'}
              colors={SLIDE_BG_COLORS}
              onChange={(bgColor) => patchSlide(selected.id, { bgColor })}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!selected}
            onClick={duplicateSlide}
          >
            <Copy size={13} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!selected}
            onClick={deleteSlide}
          >
            <Trash2 size={13} className="text-rose-500" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowImport((v) => !v)}
          >
            <FileUp size={13} /> Import
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
          {imageBusy ? (
            <Loader2 size={13} className="animate-spin text-slate-400 dark:text-slate-500" />
          ) : null}
          {importBadge}
        </SlideRibbon>
      )}

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="flex gap-4 px-5 py-5">
          {/* filmstrip (slide order is derived from the master when mastered) */}
          <div className="w-40 shrink-0">
            {mastered ? (
              <ul className="app-scroll max-h-[70vh] space-y-2 overflow-y-auto pr-1">
                {deck.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => selectSlide(s.id)}
                      className={cn(
                        'block w-full rounded-md p-0.5 text-left',
                        s.id === selected?.id
                          ? 'ring-2 ring-teal-500'
                          : 'hover:ring-2 hover:ring-slate-300 dark:hover:ring-slate-700',
                      )}
                    >
                      <SlideThumb slide={s} attachmentUrls={urls} />
                      <span className="mt-0.5 block px-1 text-[10px] text-slate-400 tabular-nums dark:text-slate-500">
                        {i + 1}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Reorder.Group
                axis="y"
                values={deck}
                onReorder={(next) => onDeckChange(next as Slide[])}
                as="ul"
                className="app-scroll max-h-[70vh] space-y-2 overflow-y-auto pr-1"
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
                      onClick={() => selectSlide(s.id)}
                      className={cn(
                        'block w-full rounded-md p-0.5 text-left',
                        s.id === selected?.id
                          ? 'ring-2 ring-teal-500'
                          : 'hover:ring-2 hover:ring-slate-300 dark:hover:ring-slate-700',
                      )}
                    >
                      <SlideThumb slide={s} attachmentUrls={urls} />
                      <span className="mt-0.5 block px-1 text-[10px] text-slate-400 tabular-nums dark:text-slate-500">
                        {i + 1}
                      </span>
                    </button>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            )}
            {deck.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                Add a slide or import a PowerPoint (ribbon ↑).
              </p>
            ) : null}
          </div>

          {/* stage */}
          <div className="min-w-0 flex-1 space-y-3">
            {showImport ? (
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <FileUploader
                  requestUploadAction={requestUpload}
                  finalizeUploadAction={finalizeUpload}
                  kind="document"
                  accept=".pptx,.ppt"
                  onUploaded={(f) => {
                    setShowImport(false)
                    void onImportPptx(f.attachmentId).then(() => {
                      toast.success('PowerPoint queued — slides appear here when converted')
                    })
                  }}
                  label="Drop a .pptx or click to choose"
                  hint="The file becomes this deck's master copy — existing slides are replaced. Speaker notes are preserved."
                />
              </div>
            ) : null}
            {selected && mastered ? (
              <>
                <SlideView
                  slide={selected}
                  attachmentUrls={urls}
                  className="rounded-lg border border-slate-200 shadow-sm dark:border-slate-800"
                />
                {selected.notes ? (
                  <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs whitespace-pre-wrap text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    {selected.notes}
                  </p>
                ) : null}
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  This deck follows its PowerPoint master. Use <strong>Edit in PowerPoint</strong>{' '}
                  to change slides or notes; the slideshow re-renders after each save.
                </p>
              </>
            ) : selected ? (
              <>
                <SlideCanvasEditor
                  key={selected.id}
                  ref={canvasApi}
                  slide={selected}
                  urls={urls}
                  onElementsChange={(elements) => patchSlide(selected.id, { elements })}
                  onSelectionChange={setSelectedElementIds}
                  onRequestImage={(elementId) => openImagePicker({ elementId })}
                />
                <Textarea
                  rows={2}
                  value={selected.notes ?? ''}
                  onChange={(e) => patchSlide(selected.id, { notes: e.currentTarget.value })}
                  placeholder="Speaker / learner notes for this slide"
                  className="bg-white dark:bg-slate-900"
                />
              </>
            ) : (
              <div className="grid aspect-[16/9] place-items-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
                {mastered
                  ? 'Slides render from the PowerPoint master once conversion finishes.'
                  : 'Add a slide from the ribbon.'}
              </div>
            )}
          </div>
        </div>
      </div>

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
              <SlidePlayer slides={deck} attachmentUrls={urls} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
