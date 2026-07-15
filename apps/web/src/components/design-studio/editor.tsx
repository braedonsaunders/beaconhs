'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Shared design-studio editor core — the Fabric canvas, zoom/viewport
// machinery, and the Insert / Layers / Inspector / Print rail panels used by
// every design-document studio (training credential Card studio, equipment
// QR-label designer). Studios differ only in their shell (how many documents
// they manage, size presets, preview endpoint) and the DATA CATALOG they
// bind fields to — everything here is subject-agnostic and driven by a
// `DesignFieldCatalog`.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BadgeCheck,
  BringToFront,
  Copy,
  Grid3X3,
  Image as ImageIcon,
  Layers3,
  Lock,
  Maximize2,
  Minimize2,
  Printer,
  QrCode,
  RectangleHorizontal,
  Scan,
  SendToBack,
  Sparkles,
  Trash2,
  Type,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  DESIGN_DOCUMENT_LIMITS,
  PRINT_PROVIDERS,
  slugId,
  type DesignArtboard,
  type DesignDataField,
  type DesignElement,
  type PrintProvider,
} from '@beaconhs/design-studio'
import { loadFabric } from '@beaconhs/design-studio/fabric'
import { Badge, Button, Input, Select, Textarea, cn } from '@beaconhs/ui'

const PPI = 96

const ZOOM_MIN = 0.1
const ZOOM_MAX = 4
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 1000) / 1000))

type ImageSource = Extract<DesignElement, { kind: 'image' }>['source']

/** What a studio's data fields bind to: options, sample values, image slots. */
export type DesignFieldCatalog = {
  options: { value: DesignDataField; label: string }[]
  sample: Partial<Record<DesignDataField, string>>
  defaultField: DesignDataField
  imageSources: { value: ImageSource; label: string }[]
}

// Shown at the top of the inspector so a selected element explains itself.
const KIND_META: Record<DesignElement['kind'], { label: string; hint: string }> = {
  text: {
    label: 'Text box',
    hint: 'Fixed text — prints exactly what you type. Double-click it on the canvas to edit inline, or use the Text field below.',
  },
  field: {
    label: 'Data field',
    hint: 'Live placeholder — filled with the record’s data each time a document is generated.',
  },
  rect: {
    label: 'Rectangle',
    hint: 'Decorative shape — use for frames, bands, and panels.',
  },
  ellipse: {
    label: 'Ellipse',
    hint: 'Decorative shape — use for circles and ovals.',
  },
  line: {
    label: 'Line',
    hint: 'Decorative rule — use for dividers and signature lines.',
  },
  image: {
    label: 'Image',
    hint: 'Placeholder box — replaced with the bound image when the document is generated.',
  },
  qr: {
    label: 'QR code',
    hint: 'Generated per record — scanning it opens that record’s public link.',
  },
  seal: {
    label: 'Seal',
    hint: 'Round badge — stamps your text (or the issuer’s initials when left blank).',
  },
}

// --- Zoom / fit / fullscreen viewport ---------------------------------------

export function useDesignZoom({
  artboard,
  reattachKey,
}: {
  artboard: { width: number; height: number } | null
  // Wheel listeners re-attach when this changes (the viewport node only exists
  // while a design is open, so remounts need a fresh native listener).
  reattachKey: unknown
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [fitMode, setFitMode] = useState(true) // recompute zoom to fit on resize
  const [fullscreen, setFullscreen] = useState(false)
  const artboardWidth = artboard?.width
  const artboardHeight = artboard?.height

  // Fit the artboard to the visible viewport (the chrome around the canvas —
  // outer p-5 + checkered p-8 — is ~120px per axis). ResizeObserver fires once
  // on observe, so switching artboards/fullscreen re-fits immediately.
  const computeFit = useCallback(() => {
    const vp = viewportRef.current
    if (!vp || !artboardWidth || !artboardHeight) return 1
    const availW = Math.max(vp.clientWidth - 120, 80)
    const availH = Math.max(vp.clientHeight - 120, 80)
    return clampZoom(Math.min(availW / (artboardWidth * PPI), availH / (artboardHeight * PPI)))
  }, [artboardHeight, artboardWidth])

  useEffect(() => {
    if (!fitMode) return
    const vp = viewportRef.current
    if (!vp) return
    const ro = new ResizeObserver(() => setZoom(computeFit()))
    ro.observe(vp)
    return () => ro.disconnect()
  }, [fitMode, computeFit, fullscreen])

  const zoomBy = useCallback((factor: number) => {
    setFitMode(false)
    setZoom((z) => clampZoom(z * factor))
  }, [])
  const zoomTo = useCallback((value: number) => {
    setFitMode(false)
    setZoom(clampZoom(value))
  }, [])
  const fitToWindow = useCallback(() => setFitMode(true), [])

  // Ctrl/⌘ + scroll (and trackpad pinch) zooms the canvas — native listener
  // because React's synthetic wheel handlers are passive.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setFitMode(false)
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [reattachKey])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  return { viewportRef, zoom, fitMode, fullscreen, setFullscreen, zoomBy, zoomTo, fitToWindow }
}

export function CanvasZoomControls({
  zoom,
  fitMode,
  fullscreen,
  zoomBy,
  zoomTo,
  fitToWindow,
  setFullscreen,
}: Pick<
  ReturnType<typeof useDesignZoom>,
  'zoom' | 'fitMode' | 'fullscreen' | 'zoomBy' | 'zoomTo' | 'fitToWindow' | 'setFullscreen'
>) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => zoomBy(1 / 1.2)}
        disabled={zoom <= ZOOM_MIN}
        aria-label={tGenerated('m_00a262469a10eb')}
        title={tGenerated('m_0dc23dde86c8b5')}
      >
        <ZoomOut size={14} />
      </Button>
      <button
        type="button"
        onClick={() => zoomTo(1)}
        title={tGenerated('m_0f91231303cad9')}
        className="w-12 rounded px-1 py-1 text-center text-xs font-medium text-slate-600 tabular-nums hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <GeneratedValue value={Math.round(zoom * 100)} />%
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => zoomBy(1.2)}
        disabled={zoom >= ZOOM_MAX}
        aria-label={tGenerated('m_12713157ff4ed0')}
        title={tGenerated('m_11077f6d324dbc')}
      >
        <ZoomIn size={14} />
      </Button>
      <Button
        type="button"
        variant={fitMode ? 'secondary' : 'ghost'}
        size="sm"
        onClick={fitToWindow}
        aria-label={tGenerated('m_0289ca594569dc')}
        title={tGenerated('m_0289ca594569dc')}
      >
        <Scan size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setFullscreen(!fullscreen)}
        aria-label={tGeneratedValue(
          fullscreen ? tGenerated('m_13170d34c93b7d') : tGenerated('m_11f08bcd4894cb'),
        )}
        title={tGeneratedValue(
          fullscreen ? tGenerated('m_1a44c3eb34ab88') : tGenerated('m_11f08bcd4894cb'),
        )}
      >
        <GeneratedValue value={fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />} />
      </Button>
    </>
  )
}

// --- Fabric canvas -----------------------------------------------------------

export function ArtboardCanvas({
  artboard,
  zoom,
  sample,
  selectedElementId,
  onSelect,
  onModify,
}: {
  artboard: DesignArtboard
  zoom: number
  /** Sample values shown inside data-field elements while editing. */
  sample: Partial<Record<DesignDataField, string>>
  selectedElementId: string | null
  // userInitiated distinguishes clicks from the programmatic re-selection that
  // happens on every rebuild — only real clicks should open the inspector.
  onSelect: (id: string | null, userInitiated: boolean) => void
  onModify: (id: string, patch: Partial<DesignElement>) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<any>(null)
  const canvasInstanceRef = useRef<any>(null)
  // Latest zoom for the async Fabric mount + post-rebuild re-asserts.
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  // URL-backed images (backgrounds, logos) render live on the canvas so the
  // builder matches the PDF instead of showing blank placeholders. Bitmaps load
  // async, so we cache the decoded <img> per URL and bump a tick to re-render
  // once each finishes. Decoded elements are reused across zoom/select rebuilds.
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const imageLoadingRef = useRef<Set<string>>(new Set())
  const [imageTick, setImageTick] = useState(0)
  const getImage = useCallback((src: string): HTMLImageElement | undefined => {
    const cached = imageCacheRef.current.get(src)
    if (cached) return cached
    if (!imageLoadingRef.current.has(src)) {
      imageLoadingRef.current.add(src)
      const img = new Image()
      img.onload = () => {
        imageCacheRef.current.set(src, img)
        imageLoadingRef.current.delete(src)
        setImageTick((t) => t + 1)
      }
      img.onerror = () => imageLoadingRef.current.delete(src)
      img.src = src
    }
    return undefined
  }, [])

  // Fabric listeners must remain attached for the lifetime of one artboard,
  // while their callbacks and the async initial render must observe the latest
  // React props. Refs provide that separation without stale closures or canvas
  // teardown on every parent render.
  const onSelectRef = useRef(onSelect)
  const onModifyRef = useRef(onModify)
  const initialRenderRef = useRef({ artboard, sample, selectedElementId, getImage })
  useEffect(() => {
    onSelectRef.current = onSelect
    onModifyRef.current = onModify
    initialRenderRef.current = { artboard, sample, selectedElementId, getImage }
  }, [artboard, getImage, onModify, onSelect, sample, selectedElementId])

  useEffect(() => {
    let disposed = false
    loadFabric().then((fabric) => {
      if (disposed || !canvasRef.current) return
      fabricRef.current = fabric
      const initial = initialRenderRef.current
      const canvas = new fabric.Canvas(canvasRef.current, {
        preserveObjectStacking: true,
        backgroundColor: initial.artboard.background,
        selection: true,
      })
      canvasInstanceRef.current = canvas
      canvas.on('selection:created', (event: any) =>
        onSelectRef.current(idForObject(event.selected?.[0]), !!event.e),
      )
      canvas.on('selection:updated', (event: any) =>
        onSelectRef.current(idForObject(event.selected?.[0]), !!event.e),
      )
      canvas.on('selection:cleared', (event: any) => onSelectRef.current(null, !!event.e))
      canvas.on('object:modified', (event: any) => {
        const object = event.target
        const id = idForObject(object)
        if (!id || !object) return
        onModifyRef.current(id, objectPatch(object, PPI * zoomRef.current))
      })
      // Inline canvas text editing (double-click on a text box) — persist the
      // typed text back into the element, or it reverts on the next rebuild.
      canvas.on('text:editing:exited', (event: any) => {
        const object = event.target
        const id = idForObject(object)
        if (!id || !object) return
        onModifyRef.current(id, {
          ...objectPatch(object, PPI * zoomRef.current),
          text: object.text ?? '',
        } as Partial<DesignElement>)
      })
      renderFabricArtboard(
        fabric,
        canvas,
        initial.artboard,
        initial.sample,
        initial.selectedElementId,
        zoomRef.current,
        initial.getImage,
      )
    })
    return () => {
      disposed = true
      canvasInstanceRef.current?.dispose()
      canvasInstanceRef.current = null
    }
  }, [artboard.id])

  useEffect(() => {
    const fabric = fabricRef.current
    const canvas = canvasInstanceRef.current
    if (!fabric || !canvas) return
    renderFabricArtboard(fabric, canvas, artboard, sample, selectedElementId, zoom, getImage)
  }, [artboard, sample, selectedElementId, zoom, getImage, imageTick])

  return (
    <div
      className="rounded-md bg-slate-300 p-8 shadow-inner dark:bg-slate-800"
      style={{
        backgroundImage:
          'linear-gradient(45deg, rgba(148,163,184,.22) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,.22) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,.22) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,.22) 75%)',
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
      }}
    >
      <div className="overflow-hidden shadow-2xl ring-1 ring-black/20">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

function renderFabricArtboard(
  fabric: Awaited<ReturnType<typeof loadFabric>>,
  canvas: any,
  artboard: DesignArtboard,
  sample: Partial<Record<DesignDataField, string>>,
  selectedElementId: string | null,
  zoom: number,
  getImage: (src: string) => HTMLImageElement | undefined,
) {
  // Zoom is baked into object coordinates (px-per-inch × zoom) rather than
  // Fabric's viewport transform — re-rendering ~30 simple objects per zoom
  // step is cheap, stays vector-crisp at any zoom, and keeps selection
  // handles at constant screen size.
  const k = PPI * zoom
  canvas.clear()
  canvas.setDimensions({ width: artboard.width * k, height: artboard.height * k })
  canvas.backgroundColor = artboard.background
  artboard.elements.forEach((element) => {
    if (element.visible === false) return
    const object = fabricObject(fabric, element, sample, k, getImage)
    if (!object) return
    object.set('beaconElementId', element.id)
    object.set({
      lockMovementX: element.locked,
      lockMovementY: element.locked,
      lockScalingX: element.locked,
      lockScalingY: element.locked,
      lockRotation: element.locked,
      selectable: !element.locked,
      evented: !element.locked,
    })
    canvas.add(object)
  })
  const active = canvas
    .getObjects()
    .find((object: any) => idForObject(object) === selectedElementId)
  if (active) canvas.setActiveObject(active)
  canvas.requestRenderAll()
}

/** Resolve an image element to a concrete <img> src the canvas can draw. */
function imageSrcForElement(element: Extract<DesignElement, { kind: 'image' }>): string | null {
  if (element.source === 'url') return element.url?.trim() || null
  return null
}

/** Build the Fabric object for an element at `k` device px per inch (PPI × zoom). */
function fabricObject(
  fabric: Awaited<ReturnType<typeof loadFabric>>,
  element: DesignElement,
  sample: Partial<Record<DesignDataField, string>>,
  k: number,
  getImage: (src: string) => HTMLImageElement | undefined,
) {
  const base = {
    left: element.x * k,
    top: element.y * k,
    // Fabric v7 defaults to CENTER origin — without these, every object draws
    // shifted by half its size (large frames/titles clip off-canvas).
    originX: 'left',
    originY: 'top',
    angle: element.rotation ?? 0,
    opacity: element.opacity ?? 1,
  }
  const width = element.width * k
  const height = element.height * k
  if (element.kind === 'text' || element.kind === 'field') {
    return new fabric.Textbox(displayTextForElement(element, sample), {
      ...base,
      width,
      height,
      fontFamily: element.fontFamily ?? 'Arial',
      fontSize: (element.fontSize ?? 12) * (k / 72),
      fontWeight: element.fontWeight ?? '600',
      fontStyle: element.fontStyle ?? 'normal',
      fill: element.color ?? '#0f172a',
      textAlign: element.align ?? 'left',
      editable: element.kind === 'text',
    })
  }
  if (element.kind === 'ellipse') {
    return new fabric.Ellipse({
      ...base,
      rx: width / 2,
      ry: height / 2,
      fill: element.fill ?? 'transparent',
      stroke: element.stroke ?? '#cbd5e1',
      strokeWidth: (element.strokeWidth ?? 0.01) * k,
    })
  }
  if (element.kind === 'line') {
    return new fabric.Line([0, 0, width, 0], {
      ...base,
      stroke: element.stroke ?? '#0f172a',
      strokeWidth: Math.max(1, (element.strokeWidth ?? 0.01) * k),
    })
  }
  if (element.kind === 'qr') {
    return new fabric.Rect({
      ...base,
      width,
      height,
      fill: element.background ?? '#ffffff',
      stroke: '#0f172a',
      strokeWidth: 1,
    })
  }
  if (element.kind === 'seal') {
    return new fabric.Circle({
      ...base,
      radius: Math.min(width, height) / 2,
      fill: element.fill ?? '#c2a05c',
      stroke: element.stroke ?? '#7a5f2b',
      strokeWidth: 2,
    })
  }
  if (element.kind === 'image') {
    const src = imageSrcForElement(element)
    const loaded = src ? getImage(src) : undefined
    if (loaded && loaded.naturalWidth > 0) {
      // Stretch the bitmap to the element box so its bounding box stays exactly
      // the element rect — keeps drag/resize mapping (objectPatch) correct.
      // Backgrounds are authored at the artboard aspect, so no visible distortion.
      const ImageCtor = (fabric as any).FabricImage ?? (fabric as any).Image
      return new ImageCtor(loaded, {
        ...base,
        scaleX: width / loaded.naturalWidth,
        scaleY: height / loaded.naturalHeight,
      })
    }
    return new fabric.Rect({
      ...base,
      width,
      height,
      fill: element.source === 'recipient.photo' ? '#dbeafe' : '#f8fafc',
      stroke: '#94a3b8',
      strokeDashArray: [6, 4],
      strokeWidth: 1,
      rx: (element.radius ?? 0) * k,
      ry: (element.radius ?? 0) * k,
    })
  }
  return new fabric.Rect({
    ...base,
    width,
    height,
    fill: element.fill ?? 'transparent',
    stroke: element.stroke ?? '#cbd5e1',
    strokeWidth: (element.strokeWidth ?? 0.01) * k,
    rx: (element.radius ?? 0) * k,
    ry: (element.radius ?? 0) * k,
  })
}

function objectPatch(object: any, k: number): Partial<DesignElement> {
  return {
    x: roundInches((object.left ?? 0) / k),
    y: roundInches((object.top ?? 0) / k),
    width: roundInches(object.getScaledWidth() / k),
    height: roundInches(object.getScaledHeight() / k),
    rotation: Math.round(object.angle ?? 0),
  }
}

function idForObject(object: any): string | null {
  return object?.beaconElementId ?? object?.get?.('beaconElementId') ?? null
}

function displayTextForElement(
  element: DesignElement,
  sample: Partial<Record<DesignDataField, string>>,
): string {
  if (element.kind === 'text') return element.text
  if (element.kind === 'field') {
    const raw = sample[element.field] ?? element.fallback ?? element.field
    const value = element.transform === 'uppercase' ? raw.toUpperCase() : raw
    return `${element.prefix ?? ''}${value}${element.suffix ?? ''}`
  }
  return element.name
}

// --- Rail panels --------------------------------------------------------------

export function InsertPanel({ onAdd }: { onAdd: (kind: DesignElement['kind']) => void }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-3">
      <RailLabel label={tGenerated('m_16f99327318dfb')} icon={<Sparkles size={14} />} />
      <ElementButton
        label={tGenerated('m_1c7e7e07a32853')}
        icon={<Type size={15} />}
        onClick={() => onAdd('text')}
      />
      <ElementButton
        label={tGenerated('m_138222fc315717')}
        icon={<BadgeCheck size={15} />}
        onClick={() => onAdd('field')}
      />
      <ElementButton
        label={tGenerated('m_1849b2d387c738')}
        icon={<RectangleHorizontal size={15} />}
        onClick={() => onAdd('rect')}
      />
      <ElementButton
        label={tGenerated('m_0f020b4cd561e6')}
        icon={<BadgeCheck size={15} />}
        onClick={() => onAdd('ellipse')}
      />
      <ElementButton
        label={tGenerated('m_13ea99a078fa96')}
        icon={<ImageIcon size={15} />}
        onClick={() => onAdd('image')}
      />
      <ElementButton
        label={tGenerated('m_02316e48e168d8')}
        icon={<QrCode size={15} />}
        onClick={() => onAdd('qr')}
      />
      <ElementButton
        label={tGenerated('m_13312cc3ff1e8a')}
        icon={<BadgeCheck size={15} />}
        onClick={() => onAdd('seal')}
      />
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
        <GeneratedText id="m_1623eb9979e59c" />
      </div>
    </div>
  )
}

export function LayersPanel({
  artboard,
  selectedElementId,
  onSelect,
  onDuplicate,
  onDelete,
  onFront,
  onBack,
}: {
  artboard: DesignArtboard
  selectedElementId: string | null
  onSelect: (id: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onFront: () => void
  onBack: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <RailLabel label={tGenerated('m_1065741cf2a494')} icon={<Layers3 size={14} />} />
        <Badge variant="secondary">
          <GeneratedValue value={artboard.elements.length} />
        </Badge>
      </div>
      <div className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDuplicate}
          disabled={!selectedElementId}
          title={tGenerated('m_13fa26360f0fe9')}
        >
          <Copy size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onFront}
          disabled={!selectedElementId}
          title={tGenerated('m_0beb88c08048c3')}
        >
          <BringToFront size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          disabled={!selectedElementId}
          title={tGenerated('m_081ec96d0986e6')}
        >
          <SendToBack size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={!selectedElementId}
          title={tGenerated('m_11773f3c3f7558')}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <div className="space-y-1.5">
        <GeneratedValue
          value={[...artboard.elements].reverse().map((element) => (
            <button
              key={element.id}
              type="button"
              onClick={() => onSelect(element.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm',
                element.id === selectedElementId
                  ? 'border-teal-700 bg-teal-50 text-teal-900 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-200'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
              )}
            >
              <GeneratedValue value={iconForElement(element)} />
              <span className="min-w-0 flex-1 truncate">
                <GeneratedValue value={element.name} />
              </span>
              <GeneratedValue
                value={
                  element.locked ? (
                    <Lock size={12} className="text-slate-400 dark:text-slate-500" />
                  ) : null
                }
              />
            </button>
          ))}
        />
      </div>
    </div>
  )
}

export function InspectorPanel({
  artboard,
  selectedElement,
  catalog,
  onPatchArtboard,
  onPatchElement,
  onDelete,
}: {
  artboard: DesignArtboard
  selectedElement: DesignElement | null
  catalog: DesignFieldCatalog
  onPatchArtboard: (patch: Partial<DesignArtboard>) => void
  onPatchElement: (patch: Partial<DesignElement>) => void
  onDelete: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  if (!selectedElement) {
    return (
      <div className="space-y-3">
        <RailLabel label={tGenerated('m_1604ec41b6c59b')} icon={<Grid3X3 size={14} />} />
        <Field label={tGenerated('m_02b18d5c7f6f2d')}>
          <Input
            value={artboard.name}
            maxLength={DESIGN_DOCUMENT_LIMITS.artboardNameLength}
            onChange={(e) => onPatchArtboard({ name: e.currentTarget.value })}
          />
        </Field>
        <ColorField
          label={tGenerated('m_197c46ade6d75f')}
          value={artboard.background}
          onChange={(background) => onPatchArtboard({ background })}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={tGenerated('m_13260774b3499b')}
            value={artboard.width}
            onChange={(width) => onPatchArtboard({ width, format: 'custom' })}
          />
          <NumberField
            label={tGenerated('m_0e936e6e874290')}
            value={artboard.height}
            onChange={(height) => onPatchArtboard({ height, format: 'custom' })}
          />
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
          <GeneratedText id="m_12b9991889a2c8" />
        </div>
      </div>
    )
  }

  const meta = KIND_META[selectedElement.kind]
  return (
    <div className="space-y-4">
      {/* What is this element? */}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedValue value={iconForElement(selectedElement)} />
            <GeneratedValue value={meta.label} />
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={tGenerated('m_175a029083c608')}
          >
            <Trash2 size={14} className="text-rose-500" />
          </Button>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
          <GeneratedValue value={meta.hint} />
        </p>
      </div>

      <Field label={tGenerated('m_0568217366722b')}>
        <Input
          value={selectedElement.name}
          maxLength={DESIGN_DOCUMENT_LIMITS.elementNameLength}
          onChange={(e) => onPatchElement({ name: e.currentTarget.value })}
        />
      </Field>

      <GeneratedValue
        value={
          selectedElement.kind === 'text' ? (
            <Field label={tGenerated('m_1ca9a0811729da')}>
              <Textarea
                rows={3}
                value={selectedElement.text}
                maxLength={DESIGN_DOCUMENT_LIMITS.textLength}
                onChange={(e) =>
                  onPatchElement({ text: e.currentTarget.value } as Partial<DesignElement>)
                }
              />
            </Field>
          ) : null
        }
      />

      <GeneratedValue
        value={
          selectedElement.kind === 'field' ? (
            <>
              <Field label={tGenerated('m_138222fc315717')}>
                <Select
                  value={selectedElement.field}
                  onChange={(e) =>
                    onPatchElement({
                      field: e.currentTarget.value as DesignDataField,
                    } as Partial<DesignElement>)
                  }
                >
                  {catalog.options.map((field) => (
                    <option key={field.value} value={field.value}>
                      {field.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="rounded-md border border-teal-100 bg-teal-50/60 px-2.5 py-2 text-xs text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200">
                <span className="font-semibold">
                  <GeneratedText id="m_1dd2ac78e8c792" />
                </span>
                <GeneratedValue value={' '} />
                <GeneratedValue
                  value={`${selectedElement.prefix ?? ''}${
                    selectedElement.transform === 'uppercase'
                      ? (catalog.sample[selectedElement.field] ?? '').toUpperCase()
                      : (catalog.sample[selectedElement.field] ?? '')
                  }${selectedElement.suffix ?? ''}`}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={tGenerated('m_00adfbfb276db4')}>
                  <Input
                    value={selectedElement.prefix ?? ''}
                    maxLength={DESIGN_DOCUMENT_LIMITS.fieldAffixLength}
                    onChange={(e) =>
                      onPatchElement({ prefix: e.currentTarget.value } as Partial<DesignElement>)
                    }
                  />
                </Field>
                <Field label={tGenerated('m_09b4b90bca1cb7')}>
                  <Input
                    value={selectedElement.suffix ?? ''}
                    maxLength={DESIGN_DOCUMENT_LIMITS.fieldAffixLength}
                    onChange={(e) =>
                      onPatchElement({ suffix: e.currentTarget.value } as Partial<DesignElement>)
                    }
                  />
                </Field>
                <Field label={tGenerated('m_0079cd733e75d4')}>
                  <Input
                    value={selectedElement.fallback ?? ''}
                    maxLength={DESIGN_DOCUMENT_LIMITS.fieldFallbackLength}
                    placeholder={tGenerated('m_0dbb83eaf1e96a')}
                    onChange={(e) =>
                      onPatchElement({ fallback: e.currentTarget.value } as Partial<DesignElement>)
                    }
                  />
                </Field>
                <Field label={tGenerated('m_1f6288d5ae6aab')}>
                  <Select
                    value={selectedElement.transform ?? 'none'}
                    onChange={(e) =>
                      onPatchElement({
                        transform: e.currentTarget.value as
                          'none' | 'uppercase' | 'date-long' | 'date-short',
                      } as Partial<DesignElement>)
                    }
                  >
                    <option value="none">{'As is'}</option>
                    <option value="uppercase">{'UPPERCASE'}</option>
                    <option value="date-long">{'Date — June 11, 2026'}</option>
                    <option value="date-short">{'Date — Jun 11, 2026'}</option>
                  </Select>
                </Field>
              </div>
            </>
          ) : null
        }
      />

      <GeneratedValue
        value={
          selectedElement.kind === 'image' ? (
            <>
              <Field label={tGenerated('m_17d5e70f58b666')}>
                <Select
                  value={selectedElement.source}
                  onChange={(e) =>
                    onPatchElement({
                      source: e.currentTarget.value as any,
                    } as Partial<DesignElement>)
                  }
                >
                  {catalog.imageSources.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <GeneratedValue
                value={
                  selectedElement.source === 'url' ? (
                    <Field label={tGenerated('m_1febb31a01f5e7')}>
                      <Input
                        value={selectedElement.url ?? ''}
                        maxLength={DESIGN_DOCUMENT_LIMITS.imageUrlLength}
                        placeholder="https://…"
                        onChange={(e) =>
                          onPatchElement({ url: e.currentTarget.value } as Partial<DesignElement>)
                        }
                      />
                    </Field>
                  ) : null
                }
              />
            </>
          ) : null
        }
      />

      <GeneratedValue
        value={
          selectedElement.kind === 'seal' ? (
            <Field label={tGenerated('m_020e4445dee967')}>
              <Input
                value={selectedElement.text ?? ''}
                maxLength={DESIGN_DOCUMENT_LIMITS.sealTextLength}
                placeholder={tGenerated('m_17413c3fbf4b8e')}
                onChange={(e) =>
                  onPatchElement({ text: e.currentTarget.value } as Partial<DesignElement>)
                }
              />
            </Field>
          ) : null
        }
      />

      <GeneratedValue
        value={
          selectedElement.kind === 'qr' ? (
            <div className="grid grid-cols-1 gap-2">
              <ColorField
                label={tGenerated('m_0570e24c85cf95')}
                value={selectedElement.foreground ?? '#0f172a'}
                onChange={(foreground) => onPatchElement({ foreground } as Partial<DesignElement>)}
              />
              <ColorField
                label={tGenerated('m_0a5bcbdd19d2fe')}
                value={selectedElement.background ?? '#ffffff'}
                onChange={(background) => onPatchElement({ background } as Partial<DesignElement>)}
              />
            </div>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label={tGenerated('m_1fd44044202a6a')}
          value={selectedElement.x}
          onChange={(x) => onPatchElement({ x })}
        />
        <NumberField
          label={tGenerated('m_1211a6d4c9ccc9')}
          value={selectedElement.y}
          onChange={(y) => onPatchElement({ y })}
        />
        <NumberField
          label={tGenerated('m_01c1568339229c')}
          value={selectedElement.width}
          onChange={(width) => onPatchElement({ width })}
        />
        <NumberField
          label={tGenerated('m_1987fe754d02dc')}
          value={selectedElement.height}
          onChange={(height) => onPatchElement({ height })}
        />
        <NumberField
          label={tGenerated('m_02bf057e3c5db8')}
          value={selectedElement.rotation ?? 0}
          onChange={(rotation) => onPatchElement({ rotation })}
        />
        <NumberField
          label={tGenerated('m_1c646d8dbbfc57')}
          value={selectedElement.opacity ?? 1}
          step={0.05}
          onChange={(opacity) => onPatchElement({ opacity })}
        />
      </div>
      <GeneratedValue
        value={
          'color' in selectedElement ? (
            <ColorField
              label={tGenerated('m_1d84613a5c9677')}
              value={selectedElement.color ?? '#0f172a'}
              onChange={(color) => onPatchElement({ color } as Partial<DesignElement>)}
            />
          ) : null
        }
      />
      <GeneratedValue
        value={
          'fill' in selectedElement ? (
            <ColorField
              label={tGenerated('m_1c8876b26b038d')}
              value={selectedElement.fill ?? '#ffffff'}
              onChange={(fill) => onPatchElement({ fill } as Partial<DesignElement>)}
            />
          ) : null
        }
      />
      <GeneratedValue
        value={
          'stroke' in selectedElement ? (
            <ColorField
              label={tGenerated('m_1283da4b0e20fd')}
              value={selectedElement.stroke ?? '#cbd5e1'}
              onChange={(stroke) => onPatchElement({ stroke } as Partial<DesignElement>)}
            />
          ) : null
        }
      />
      <GeneratedValue
        value={
          'fontSize' in selectedElement ? (
            <>
              <NumberField
                label={tGenerated('m_148c58241fd1d4')}
                value={selectedElement.fontSize ?? 12}
                onChange={(fontSize) => onPatchElement({ fontSize } as Partial<DesignElement>)}
              />
              <div className="grid grid-cols-3 gap-1">
                <Button
                  type="button"
                  variant={selectedElement.align === 'left' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => onPatchElement({ align: 'left' } as Partial<DesignElement>)}
                >
                  <AlignLeft size={14} />
                </Button>
                <Button
                  type="button"
                  variant={selectedElement.align === 'center' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => onPatchElement({ align: 'center' } as Partial<DesignElement>)}
                >
                  <AlignCenter size={14} />
                </Button>
                <Button
                  type="button"
                  variant={selectedElement.align === 'right' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => onPatchElement({ align: 'right' } as Partial<DesignElement>)}
                >
                  <AlignRight size={14} />
                </Button>
              </div>
            </>
          ) : null
        }
      />
      <LayerToggle
        checked={!selectedElement.locked}
        label={tGeneratedValue(
          selectedElement.locked ? tGenerated('m_0e259fa0babc2d') : tGenerated('m_16508b5ee9cd07'),
        )}
        onChange={(unlocked) => onPatchElement({ locked: !unlocked })}
        icon={selectedElement.locked ? <Lock size={14} /> : <Unlock size={14} />}
      />
    </div>
  )
}

export function PrintPanel({
  artboard,
  onPatchArtboard,
}: {
  artboard: DesignArtboard
  onPatchArtboard: (patch: Partial<DesignArtboard>) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const profile = artboard.printProfile ?? {
    provider: 'browser-pdf' as PrintProvider,
    media: artboard.format === 'cr80-front' || artboard.format === 'cr80-back' ? 'cr80' : 'letter',
    duplex: artboard.format === 'cr80-front' || artboard.format === 'cr80-back',
    edgeToEdge: true,
    orientation: 'landscape' as const,
  }
  return (
    <div className="space-y-4">
      <RailLabel label={tGenerated('m_06fbf5dca19848')} icon={<Printer size={14} />} />
      <Field label={tGenerated('m_1c4d663fc7d77f')}>
        <Select
          value={profile.provider}
          onChange={(e) =>
            onPatchArtboard({
              printProfile: { ...profile, provider: e.currentTarget.value as PrintProvider },
            })
          }
        >
          {PRINT_PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={tGenerated('m_09db70b9dfd3ed')}>
        <Select
          value={profile.media}
          onChange={(e) =>
            onPatchArtboard({
              printProfile: { ...profile, media: e.currentTarget.value as any },
            })
          }
        >
          <option value="letter">{'Letter'}</option>
          <option value="cr80">{'CR80 card'}</option>
          <option value="custom">{'Custom'}</option>
        </Select>
      </Field>
      <LayerToggle
        checked={profile.duplex === true}
        label={tGenerated('m_09cdda4df8e928')}
        onChange={(duplex) => onPatchArtboard({ printProfile: { ...profile, duplex } })}
      />
      <LayerToggle
        checked={profile.edgeToEdge !== false}
        label={tGenerated('m_10f5cd6acb899b')}
        onChange={(edgeToEdge) => onPatchArtboard({ printProfile: { ...profile, edgeToEdge } })}
      />
      <div className="space-y-2">
        <GeneratedValue
          value={PRINT_PROVIDERS.map((provider) => (
            <div
              key={provider.id}
              className={cn(
                'rounded-md border p-2 text-xs leading-5',
                provider.id === profile.provider
                  ? 'border-teal-700 bg-teal-50 text-teal-900 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-200'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
              )}
            >
              <div className="font-semibold">
                <GeneratedValue value={provider.label} />
              </div>
              <div>
                <GeneratedValue value={provider.notes} />
              </div>
              <GeneratedValue
                value={
                  provider.requiresLocalBridge ? (
                    <div className="mt-1 font-medium">
                      <GeneratedText id="m_1618e6c010fa0a" />
                    </div>
                  ) : null
                }
              />
            </div>
          ))}
        />
      </div>
    </div>
  )
}

// --- Small rail atoms ----------------------------------------------------------

export function RailTabButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      onClick={onClick}
      title={tGeneratedValue(label)}
      className={cn(
        'grid h-9 place-items-center rounded-md border text-xs',
        active
          ? 'border-teal-700 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-300'
          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      <GeneratedValue value={icon} />
    </button>
  )
}

export function RailLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
      <GeneratedValue value={icon} />
      <GeneratedValue value={label} />
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
        <GeneratedValue value={label} />
      </span>
      <GeneratedValue value={children} />
    </label>
  )
}

function ElementButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <GeneratedValue value={icon} />
      <GeneratedValue value={label} />
    </button>
  )
}

export function LayerToggle({
  checked,
  label,
  onChange,
  icon,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
  icon?: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
      <span className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-200">
        <GeneratedValue value={icon} />
        <span className="truncate">
          <GeneratedValue value={label} />
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="h-4 w-4 accent-teal-700"
      />
    </label>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 text-xs font-medium text-slate-600 dark:text-slate-300">
        <GeneratedValue value={label} />
      </span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="h-8 w-10 rounded border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-900"
      />
      <Input
        value={value}
        maxLength={11}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="h-8"
      />
    </label>
  )
}

function NumberField({
  label,
  value,
  step = 0.01,
  onChange,
}: {
  label: string
  value: number
  step?: number
  onChange: (value: number) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <Field label={tGeneratedValue(label)}>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </Field>
  )
}

function iconForElement(element: DesignElement): ReactNode {
  if (element.kind === 'text') return <Type size={14} />
  if (element.kind === 'field') return <BadgeCheck size={14} />
  if (element.kind === 'image') return <ImageIcon size={14} />
  if (element.kind === 'qr') return <QrCode size={14} />
  return <RectangleHorizontal size={14} />
}

// --- Element construction --------------------------------------------------------

export function newElement(
  kind: DesignElement['kind'],
  existing: DesignElement[],
  defaultField: DesignDataField,
): DesignElement {
  const id = uniqueElementId(kind, existing)
  const base = {
    id,
    name: titleCase(kind),
    x: 0.55,
    y: 0.55,
    width: kind === 'qr' || kind === 'seal' ? 0.8 : 2.2,
    height: kind === 'qr' || kind === 'seal' ? 0.8 : 0.45,
    visible: true,
    opacity: 1,
  }
  if (kind === 'text') {
    return {
      ...base,
      kind,
      text: 'New text',
      fontFamily: "'Archivo', Arial, sans-serif",
      fontSize: 16,
      fontWeight: '700',
      color: '#0f172a',
      align: 'left',
    }
  }
  if (kind === 'field') {
    return {
      ...base,
      kind,
      field: defaultField,
      fontFamily: "'Archivo', Arial, sans-serif",
      fontSize: 16,
      fontWeight: '700',
      color: '#0f172a',
      align: 'left',
      transform: 'none',
    }
  }
  if (kind === 'image')
    return { ...base, kind, source: 'tenant.logo', fit: 'contain', radius: 0.04 }
  if (kind === 'qr')
    return { ...base, kind, field: 'verify.qr', background: '#ffffff', foreground: '#0f172a' }
  if (kind === 'seal') return { ...base, kind, fill: '#c2a05c', stroke: '#7a5f2b', text: '' }
  if (kind === 'ellipse')
    return { ...base, kind, fill: '#ffffff', stroke: '#0f766e', strokeWidth: 0.01 }
  if (kind === 'line')
    return {
      ...base,
      kind,
      height: 0.01,
      fill: 'transparent',
      stroke: '#0f172a',
      strokeWidth: 0.01,
    }
  return {
    ...base,
    kind: 'rect',
    fill: '#ffffff',
    stroke: '#0f766e',
    strokeWidth: 0.01,
    radius: 0.03,
  }
}

export function uniqueElementId(base: string, elements: DesignElement[]) {
  const used = new Set(elements.map((element) => element.id))
  const clean = slugId(base, 'element').slice(0, DESIGN_DOCUMENT_LIMITS.idLength)
  let id = clean
  let i = 2
  while (used.has(id)) {
    const suffix = `-${i}`
    id = `${clean.slice(0, DESIGN_DOCUMENT_LIMITS.idLength - suffix.length)}${suffix}`
    i += 1
  }
  return id
}

function titleCase(value: string) {
  return value.replace(
    /(^|-)([a-z])/g,
    (_, space: string, letter: string) => `${space ? ' ' : ''}${letter.toUpperCase()}`,
  )
}

function roundInches(value: number): number {
  return Math.round(value * 1000) / 1000
}
