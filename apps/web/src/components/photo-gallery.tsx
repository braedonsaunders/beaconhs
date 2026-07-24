'use client'

import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Check, ChevronLeft, ChevronRight, Pencil, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { Button, Input, Label, cn } from '@beaconhs/ui'
import type { Annotation } from '@beaconhs/db/schema'
import { MAX_PHOTO_ANNOTATIONS, MAX_PHOTO_ANNOTATION_POINTS } from '@beaconhs/forms-core'
import { RawImage } from '@/components/raw-image'
import { confirmDialog } from '@/lib/confirm'
import { toast } from 'sonner'

export type GalleryPhoto = {
  id: string
  attachmentId?: string
  url: string
  filename: string
  caption?: string | null
  annotations?: Annotation[] | null
  width?: number | null
  height?: number | null
}

export type PhotoEdits = {
  caption: string
  annotations: Annotation[]
}

type MutationResult = void | { ok: boolean; error?: string }

const DRAWING_SIZE = 1_000
const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#0ea5e9', '#ffffff', '#111827'] as const

function AnnotationMarks({ annotations }: { annotations: Annotation[] }) {
  return (
    <>
      {annotations.map((annotation, index) => {
        const key = `${annotation.type}-${index}`
        if (annotation.type === 'free') {
          return (
            <polyline
              key={key}
              points={annotation.points.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke={annotation.color}
              strokeWidth={annotation.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        }
        if (annotation.type === 'arrow') {
          return (
            <line
              key={key}
              x1={annotation.from[0]}
              y1={annotation.from[1]}
              x2={annotation.to[0]}
              y2={annotation.to[1]}
              stroke={annotation.color}
              strokeWidth={annotation.width}
              strokeLinecap="round"
            />
          )
        }
        if (annotation.type === 'circle') {
          return (
            <circle
              key={key}
              cx={annotation.cx}
              cy={annotation.cy}
              r={annotation.r}
              fill="none"
              stroke={annotation.color}
              strokeWidth={annotation.width}
            />
          )
        }
        if (annotation.type === 'rect') {
          return (
            <rect
              key={key}
              x={annotation.x}
              y={annotation.y}
              width={annotation.w}
              height={annotation.h}
              fill="none"
              stroke={annotation.color}
              strokeWidth={annotation.width}
            />
          )
        }
        return (
          <text
            key={key}
            x={annotation.x}
            y={annotation.y}
            fill={annotation.color}
            fontSize={annotation.size}
          >
            {annotation.text}
          </text>
        )
      })}
    </>
  )
}

function AnnotationLayer({ annotations }: { annotations: Annotation[] }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${DRAWING_SIZE} ${DRAWING_SIZE}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <AnnotationMarks annotations={annotations} />
    </svg>
  )
}

function PhotoEditor({
  photo,
  onClose,
  onSave,
}: {
  photo: GalleryPhoto
  onClose: () => void
  onSave: (edits: PhotoEdits) => Promise<MutationResult>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const [caption, setCaption] = useState(photo.caption ?? '')
  const [annotations, setAnnotations] = useState<Annotation[]>(photo.annotations ?? [])
  const [color, setColor] = useState<(typeof COLORS)[number]>('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState(8)
  const [drawing, setDrawing] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  const surface = useRef<SVGSVGElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function point(event: React.PointerEvent<SVGSVGElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect()
    return [
      Math.max(
        0,
        Math.min(DRAWING_SIZE, ((event.clientX - rect.left) / rect.width) * DRAWING_SIZE),
      ),
      Math.max(
        0,
        Math.min(DRAWING_SIZE, ((event.clientY - rect.top) / rect.height) * DRAWING_SIZE),
      ),
    ]
  }

  function begin(event: React.PointerEvent<SVGSVGElement>) {
    if (annotations.length >= MAX_PHOTO_ANNOTATIONS) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const next: Annotation = {
      type: 'free',
      points: [point(event)],
      color,
      width: strokeWidth,
    }
    setAnnotations((current) => {
      setDrawing(current.length)
      return [...current, next]
    })
  }

  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (drawing === null) return
    const nextPoint = point(event)
    setAnnotations((current) =>
      current.map((annotation, index) =>
        index === drawing && annotation.type === 'free'
          ? {
              ...annotation,
              points:
                annotation.points.length < MAX_PHOTO_ANNOTATION_POINTS
                  ? [...annotation.points, nextPoint]
                  : annotation.points,
            }
          : annotation,
      ),
    )
  }

  function end() {
    setDrawing(null)
  }

  function save() {
    startTransition(async () => {
      try {
        const result = await onSave({ caption, annotations })
        if (result && !result.ok) {
          toast.error(tGeneratedValue(result.error ?? 'Photo could not be saved.'))
          return
        }
        onClose()
      } catch (error) {
        toast.error(
          tGeneratedValue(error instanceof Error ? error.message : 'Photo could not be saved.'),
        )
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tGeneratedValue('Edit photo')}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3 sm:p-6"
    >
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div>
            <div className="font-semibold text-slate-900 dark:text-white">
              <GeneratedValue value="Edit photo" />
            </div>
            <div className="max-w-[60vw] truncate text-xs text-slate-500">{photo.filename}</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={tGeneratedValue('Close')}
          >
            <X size={18} />
          </Button>
        </div>

        <div className="min-h-0 overflow-auto p-3 sm:p-5">
          <div className="relative mx-auto w-fit max-w-full touch-none overflow-hidden bg-slate-900">
            <RawImage
              src={photo.url}
              alt={tGeneratedValue(photo.caption ?? photo.filename)}
              optimizationReason="authenticated"
              width={photo.width ?? undefined}
              height={photo.height ?? undefined}
              draggable={false}
              className="block h-auto max-h-[60vh] w-auto max-w-full object-contain select-none"
            />
            <svg
              ref={surface}
              viewBox={`0 0 ${DRAWING_SIZE} ${DRAWING_SIZE}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full cursor-crosshair"
              onPointerDown={begin}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              <AnnotationMarks annotations={annotations} />
            </svg>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor={`photo-caption-${photo.id}`}>
                <GeneratedValue value="Caption" />
              </Label>
              <Input
                id={`photo-caption-${photo.id}`}
                value={caption}
                maxLength={1_000}
                onChange={(event) => setCaption(event.target.value)}
                placeholder={tGeneratedValue('Describe what this photo shows')}
              />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label>
                  <GeneratedValue value="Markup colour" />
                </Label>
                <div className="flex gap-1">
                  {COLORS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-label={value}
                      aria-pressed={color === value}
                      onClick={() => setColor(value)}
                      className={cn(
                        'grid h-9 w-9 place-items-center rounded-full border-2 shadow-sm',
                        color === value ? 'border-teal-500' : 'border-white dark:border-slate-700',
                      )}
                      style={{ backgroundColor: value }}
                    >
                      {color === value ? (
                        <Check
                          size={14}
                          className={value === '#ffffff' ? 'text-slate-900' : 'text-white'}
                        />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`photo-width-${photo.id}`}>
                  <GeneratedValue value="Line" />
                </Label>
                <Input
                  id={`photo-width-${photo.id}`}
                  type="range"
                  min={3}
                  max={24}
                  value={strokeWidth}
                  onChange={(event) => setStrokeWidth(Number(event.target.value))}
                  className="w-24"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={annotations.length === 0}
                onClick={() => setAnnotations((current) => current.slice(0, -1))}
              >
                <Undo2 size={14} /> <GeneratedValue value="Undo" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={annotations.length === 0}
                onClick={() => setAnnotations([])}
              >
                <RotateCcw size={14} /> <GeneratedValue value="Clear" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose}>
            <GeneratedValue value="Cancel" />
          </Button>
          <Button type="button" onClick={save} disabled={pending || drawing !== null}>
            <GeneratedValue value={pending ? 'Saving…' : 'Save photo'} />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function PhotoGallery({
  photos,
  editable = false,
  onUpdate,
  onRemove,
  onReorder,
}: {
  photos: GalleryPhoto[]
  editable?: boolean
  onUpdate?: (photoId: string, edits: PhotoEdits) => Promise<MutationResult>
  onRemove?: (photoId: string) => Promise<MutationResult>
  onReorder?: (photoIds: string[]) => Promise<MutationResult>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [lightbox, setLightbox] = useState<GalleryPhoto | null>(null)
  const [editing, setEditing] = useState<GalleryPhoto | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [optimisticOrder, setOptimisticOrder] = useState<{
    baseOrderKey: string
    photoIds: string[]
  } | null>(null)
  const [pending, startTransition] = useTransition()
  const propOrderKey = photos.map((photo) => photo.id).join('\0')
  const photosById = new Map(photos.map((photo) => [photo.id, photo] as const))
  const orderedPhotos =
    optimisticOrder?.baseOrderKey === propOrderKey
      ? optimisticOrder.photoIds.flatMap((photoId) => {
          const photo = photosById.get(photoId)
          return photo ? [photo] : []
        })
      : photos

  function move(photoId: string, direction: -1 | 1) {
    if (!onReorder || pending) return
    const currentIndex = orderedPhotos.findIndex((photo) => photo.id === photoId)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedPhotos.length) return
    const next = [...orderedPhotos]
    const [moved] = next.splice(currentIndex, 1)
    if (!moved) return
    next.splice(nextIndex, 0, moved)
    setOptimisticOrder({ baseOrderKey: propOrderKey, photoIds: next.map((photo) => photo.id) })
    startTransition(async () => {
      try {
        const result = await onReorder(next.map((photo) => photo.id))
        if (result && !result.ok) {
          setOptimisticOrder(null)
          toast.error(tGeneratedValue(result.error ?? 'Photos could not be reordered.'))
        }
      } catch (error) {
        setOptimisticOrder(null)
        toast.error(
          tGeneratedValue(
            error instanceof Error ? error.message : 'Photos could not be reordered.',
          ),
        )
      }
    })
  }

  async function remove(photo: GalleryPhoto) {
    if (!onRemove) return
    if (
      !(await confirmDialog({
        message: 'Remove this photo from the record?',
        tone: 'danger',
      }))
    ) {
      return
    }
    setRemoving(photo.id)
    startTransition(async () => {
      try {
        const result = await onRemove(photo.id)
        if (result && !result.ok) {
          toast.error(tGeneratedValue(result.error ?? 'Photo could not be removed.'))
        }
      } catch (error) {
        toast.error(
          tGeneratedValue(error instanceof Error ? error.message : 'Photo could not be removed.'),
        )
      } finally {
        setRemoving(null)
      }
    })
  }

  if (photos.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_177e2d48fbc8cb" />
      </p>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <GeneratedValue
          value={orderedPhotos.map((photo, index) => (
            <div
              key={photo.id}
              className="group relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
            >
              <button
                type="button"
                onClick={() => setLightbox(photo)}
                className="absolute inset-0"
                aria-label={tGeneratedValue('Open photo')}
              >
                <RawImage
                  src={photo.url}
                  alt={tGeneratedValue(photo.caption ?? photo.filename)}
                  optimizationReason="authenticated"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
              {photo.caption ? (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                  <GeneratedValue value={photo.caption} />
                </span>
              ) : null}
              {photo.annotations?.length ? (
                <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
                  <GeneratedValue value="Marked up" />
                </span>
              ) : null}
              {editable && (onUpdate || onRemove || onReorder) ? (
                <div className="absolute top-1 right-1 flex gap-1">
                  {onReorder ? (
                    <>
                      <button
                        type="button"
                        onClick={() => move(photo.id, -1)}
                        disabled={pending || index === 0}
                        className="grid h-8 w-8 place-items-center rounded-md bg-white/95 text-slate-800 shadow hover:bg-white disabled:opacity-45 dark:bg-slate-900/95 dark:text-white"
                        aria-label={tGeneratedValue('Move photo earlier')}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(photo.id, 1)}
                        disabled={pending || index === orderedPhotos.length - 1}
                        className="grid h-8 w-8 place-items-center rounded-md bg-white/95 text-slate-800 shadow hover:bg-white disabled:opacity-45 dark:bg-slate-900/95 dark:text-white"
                        aria-label={tGeneratedValue('Move photo later')}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </>
                  ) : null}
                  {onUpdate ? (
                    <button
                      type="button"
                      onClick={() => setEditing(photo)}
                      className="grid h-8 w-8 place-items-center rounded-md bg-white/95 text-slate-800 shadow hover:bg-white dark:bg-slate-900/95 dark:text-white"
                      aria-label={tGeneratedValue('Edit photo')}
                    >
                      <Pencil size={14} />
                    </button>
                  ) : null}
                  {onRemove ? (
                    <button
                      type="button"
                      onClick={() => remove(photo)}
                      disabled={pending && removing === photo.id}
                      className="grid h-8 w-8 place-items-center rounded-md bg-white/95 text-red-600 shadow hover:bg-white dark:bg-slate-900/95"
                      aria-label={tGeneratedValue('Remove photo')}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        />
      </div>

      <GeneratedValue
        value={
          lightbox ? (
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
              onClick={() => setLightbox(null)}
            >
              <button
                className="absolute top-4 right-4 text-white hover:text-slate-300"
                onClick={() => setLightbox(null)}
                aria-label={tGenerated('m_19ab80ae228d44')}
              >
                <X size={20} />
              </button>
              <div
                className="max-h-full max-w-full overflow-auto"
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className="relative max-h-full max-w-full"
                  style={{
                    aspectRatio:
                      lightbox.width && lightbox.height
                        ? lightbox.width / lightbox.height
                        : undefined,
                  }}
                >
                  <RawImage
                    src={lightbox.url}
                    alt={tGeneratedValue(lightbox.caption ?? lightbox.filename)}
                    optimizationReason="authenticated"
                    className="max-h-[80vh] max-w-[90vw] rounded-md object-contain"
                  />
                  {lightbox.annotations?.length ? (
                    <AnnotationLayer annotations={lightbox.annotations} />
                  ) : null}
                </div>
                {lightbox.caption ? (
                  <p className="mx-auto mt-2 max-w-[90vw] rounded bg-black/65 px-3 py-2 text-center text-sm whitespace-pre-wrap text-white">
                    <GeneratedValue value={lightbox.caption} />
                  </p>
                ) : null}
              </div>
            </div>
          ) : null
        }
      />

      {editing && onUpdate ? (
        <PhotoEditor
          photo={editing}
          onClose={() => setEditing(null)}
          onSave={(edits) => onUpdate(editing.id, edits)}
        />
      ) : null}
    </>
  )
}
