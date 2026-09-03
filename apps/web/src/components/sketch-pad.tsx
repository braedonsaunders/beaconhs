'use client'

import { GeneratedText, GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'

// SketchPad — a comprehensive freehand drawing / diagram canvas built on
// Excalidraw (shapes, arrows, text, freehand, images). Used by the form
// `sketch` element (e.g. a lift-plan diagram). Outputs a PNG data-url plus the
// editable Excalidraw scene so the drawing can be re-opened and amended.
//
// Excalidraw touches `window` at module scope, so it is loaded via
// `next/dynamic` with `ssr: false`. The filler only mounts this component
// inside the Draw-diagram drawer — the heavy bundle stays off the form page.

import { useCallback, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Save, Shapes, Sparkles, Trash2 } from 'lucide-react'
import { Button, Label, Textarea } from '@beaconhs/ui'
import type { SketchDraftElement, SketchSymbol } from '@beaconhs/forms-core'
import '@excalidraw/excalidraw/index.css'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from '@excalidraw/excalidraw/types'

const Excalidraw = dynamic<ExcalidrawProps>(
  async () => (await import('@excalidraw/excalidraw')).Excalidraw,
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
        <GeneratedText id="m_0839e554b28c58" />
      </div>
    ),
  },
)

// The editable scene we persist alongside the rendered PNG. Opaque JSON —
// handed straight back to Excalidraw's `initialData` to re-hydrate.
export type SketchScene = {
  elements?: readonly unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

type SketchPadProps = {
  /** Previously-saved scene to re-open, or null for a blank canvas. */
  initialScene?: SketchScene | null
  /** Called only when the user explicitly saves or clears the drawing. */
  onSave: (dataUrl: string | null, scene: SketchScene) => Promise<void>
  /** Canvas height in CSS pixels. Default 440. */
  height?: number
  /** When true, the canvas is non-editable (Excalidraw view mode). */
  readOnly?: boolean
  /** Tenant-authored symbol library for this sketch element. Tapping a
      symbol inserts a fresh copy of its elements into the live canvas as an
      editable draft — the drawing only persists on explicit save. */
  symbols?: SketchSymbol[]
  /** AI drafting hook. When present (AI configured + permitted), the canvas
      offers a description box whose result inserts as an editable draft for
      human review — never auto-saved. Null hides the affordance (offline). */
  aiDraft?: {
    request: (
      description: string,
    ) => Promise<{ ok: true; elements: SketchDraftElement[] } | { ok: false; error: string }>
  } | null
}

// Offset step so repeated inserts cascade instead of stacking exactly.
const SYMBOL_INSERT_OFFSET_STEP = 24

// Convert AI draft primitives into Excalidraw elements. Missing visual props
// are filled with calm defaults; `restore` on the Excalidraw side backfills
// anything else. Ids/seeds are minted fresh so the draft never collides with
// existing drawing content. Labels on boxes/arrows become separate text
// elements so the user can move or restyle them independently.
const DRAFT_DEFAULTS = {
  strokeColor: '#1e293b',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  roughness: 1,
  fontSize: 20,
} as const

function estimateTextSize(text: string): { w: number; h: number } {
  const lines = text.split('\n')
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  return {
    w: Math.min(600, Math.max(40, longest * DRAFT_DEFAULTS.fontSize * 0.55 + 20)),
    h: Math.max(25, lines.length * DRAFT_DEFAULTS.fontSize * 1.25 + 10),
  }
}

export function buildDraftElements(primitives: SketchDraftElement[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const primitive of primitives) {
    const base = {
      id: crypto.randomUUID(),
      seed: Math.floor(Math.random() * 2 ** 31),
      versionNonce: Math.floor(Math.random() * 2 ** 31),
      strokeColor: DRAFT_DEFAULTS.strokeColor,
      backgroundColor: DRAFT_DEFAULTS.backgroundColor,
      fillStyle: 'solid',
      strokeWidth: DRAFT_DEFAULTS.strokeWidth,
      strokeStyle: 'solid',
      roughness: DRAFT_DEFAULTS.roughness,
      opacity: 100,
      angle: 0,
      roundness: null,
      boundElements: null,
      link: null,
      locked: false,
    }
    if (primitive.kind === 'box') {
      const shape =
        primitive.shape === 'ellipse'
          ? 'ellipse'
          : primitive.shape === 'diamond'
            ? 'diamond'
            : 'rectangle'
      out.push({
        ...base,
        type: shape,
        x: primitive.x,
        y: primitive.y,
        width: primitive.w,
        height: primitive.h,
      })
      if (primitive.label) {
        const size = estimateTextSize(primitive.label)
        out.push({
          ...base,
          id: crypto.randomUUID(),
          type: 'text',
          x: primitive.x + Math.max(0, (primitive.w - size.w) / 2),
          y: primitive.y + Math.max(0, (primitive.h - size.h) / 2),
          width: size.w,
          height: size.h,
          fontSize: DRAFT_DEFAULTS.fontSize,
          text: primitive.label,
          originalText: primitive.label,
          textAlign: 'center',
          verticalAlign: 'middle',
        })
      }
    } else if (primitive.kind === 'arrow') {
      const dx = primitive.x2 - primitive.x1
      const dy = primitive.y2 - primitive.y1
      out.push({
        ...base,
        type: 'arrow',
        x: primitive.x1,
        y: primitive.y1,
        width: Math.abs(dx) || 1,
        height: Math.abs(dy) || 1,
        points: [
          [0, 0],
          [dx, dy],
        ],
        elbowed: false,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: 'arrow',
      })
      if (primitive.label) {
        const size = estimateTextSize(primitive.label)
        out.push({
          ...base,
          id: crypto.randomUUID(),
          type: 'text',
          x: (primitive.x1 + primitive.x2) / 2 - size.w / 2,
          y: (primitive.y1 + primitive.y2) / 2 - size.h - 6,
          width: size.w,
          height: size.h,
          fontSize: DRAFT_DEFAULTS.fontSize,
          text: primitive.label,
          originalText: primitive.label,
          textAlign: 'center',
          verticalAlign: 'middle',
        })
      }
    } else {
      const size = estimateTextSize(primitive.text)
      out.push({
        ...base,
        type: 'text',
        x: primitive.x,
        y: primitive.y,
        width: size.w,
        height: size.h,
        fontSize: DRAFT_DEFAULTS.fontSize,
        text: primitive.text,
        originalText: primitive.text,
        textAlign: 'left',
        verticalAlign: 'top',
      })
    }
  }
  return out
}

function freshSymbolElements(symbol: SketchSymbol, insertCount: number): unknown[] {
  const offset = SYMBOL_INSERT_OFFSET_STEP * ((insertCount % 6) + 1)
  return symbol.elements.map((element) => {
    const record = { ...(element as Record<string, unknown>) }
    record.id = crypto.randomUUID()
    // Re-mint collab/version fields Excalidraw treats as identity so the
    // pasted copy never collides with the library original or a sibling copy.
    record.seed = Math.floor(Math.random() * 2 ** 31)
    record.versionNonce = Math.floor(Math.random() * 2 ** 31)
    if (typeof record.x === 'number') record.x = record.x + offset
    if (typeof record.y === 'number') record.y = record.y + offset
    return record
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function SketchPad({
  initialScene,
  onSave,
  height = 440,
  readOnly = false,
  symbols = [],
  aiDraft = null,
}: SketchPadProps) {
  const tGenerated = useGeneratedTranslations()
  type ChangeArgs = Parameters<NonNullable<ExcalidrawProps['onChange']>>
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const elementsRef = useRef<ChangeArgs[0]>([])
  const appStateRef = useRef<ChangeArgs[1] | null>(null)
  const filesRef = useRef<ChangeArgs[2]>({})
  const hydratedRef = useRef(false)
  const suppressDirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const insertCountRef = useRef(0)

  function insertElements(fresh: unknown[]) {
    const api = apiRef.current
    if (!api) return
    const live = elementsRef.current.filter((element) => !element.isDeleted)
    insertCountRef.current += 1
    suppressDirtyRef.current = true
    try {
      api.updateScene({
        elements: [...live, ...(fresh as never[])],
      })
    } finally {
      suppressDirtyRef.current = false
    }
    // onChange fires synchronously off updateScene, so mark dirty after.
    setDirty(true)
  }

  function insertSymbol(symbol: SketchSymbol) {
    insertElements(freshSymbolElements(symbol, insertCountRef.current))
  }

  const [draftOpen, setDraftOpen] = useState(false)
  const [draftDescription, setDraftDescription] = useState('')
  const [drafting, setDrafting] = useState(false)

  async function requestDraft() {
    if (!aiDraft || drafting) return
    const description = draftDescription.trim()
    if (!description) return
    setDrafting(true)
    setError(null)
    try {
      const result = await aiDraft.request(description)
      if (!result.ok) {
        setError(result.error)
        return
      }
      insertElements(buildDraftElements(result.elements))
      setDraftOpen(false)
      setDraftDescription('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tGenerated('m_1b498b9d98d273'))
    } finally {
      setDrafting(false)
    }
  }

  const handleChange = useCallback<NonNullable<ExcalidrawProps['onChange']>>(
    (elements, appState, files) => {
      elementsRef.current = elements
      appStateRef.current = appState
      filesRef.current = files
      if (!hydratedRef.current) {
        hydratedRef.current = true
        return
      }
      if (!suppressDirtyRef.current) setDirty(true)
    },
    [],
  )

  async function saveDrawing() {
    const appState = appStateRef.current
    if (!appState) return
    setSaving(true)
    setError(null)
    try {
      const live = elementsRef.current.filter((element) => !element.isDeleted)
      const scene: SketchScene = {
        elements: live,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
        files: filesRef.current,
      }
      if (live.length === 0) {
        await onSave(null, scene)
      } else {
        const { exportToBlob } = await import('@excalidraw/excalidraw')
        const blob = await exportToBlob({
          elements: live,
          appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
          files: filesRef.current,
          mimeType: 'image/png',
          quality: 0.92,
        })
        await onSave(await blobToDataUrl(blob), scene)
      }
      setDirty(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tGenerated('m_1b498b9d98d273'))
    } finally {
      setSaving(false)
    }
  }

  async function clearDrawing() {
    setSaving(true)
    setError(null)
    suppressDirtyRef.current = true
    try {
      apiRef.current?.resetScene()
      const scene: SketchScene = { elements: [], appState: {}, files: {} }
      await onSave(null, scene)
      setDirty(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tGenerated('m_16dc0360a1d406'))
      setDirty(true)
    } finally {
      suppressDirtyRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {!readOnly && (symbols.length > 0 || aiDraft) ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {aiDraft ? (
            <button
              type="button"
              onClick={() => setDraftOpen((open) => !open)}
              aria-expanded={draftOpen}
              className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 transition-colors hover:bg-teal-100 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-950/70"
            >
              <Sparkles size={13} /> <GeneratedText id="m_1337c4fd9d11a6" />
            </button>
          ) : null}
          {symbols.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Shapes size={13} /> <GeneratedText id="m_0e697f25f50ced" />
            </span>
          ) : null}
          <GeneratedValue
            value={symbols.map((symbol) => (
              <button
                key={symbol.name}
                type="button"
                onClick={() => insertSymbol(symbol)}
                title={tGenerated('m_1aae0856485bb1', { value0: symbol.name })}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <GeneratedValue value={symbol.name} />
              </button>
            ))}
          />
        </div>
      ) : null}
      {!readOnly && aiDraft && draftOpen ? (
        <div className="space-y-1.5 rounded-md border border-teal-200 bg-teal-50/50 p-2.5 dark:border-teal-900 dark:bg-teal-950/20">
          <Label className="text-xs">
            <GeneratedText id="m_1b6695bd5f7f0d" />
          </Label>
          <Textarea
            value={draftDescription}
            maxLength={2000}
            rows={2}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder={tGenerated('m_1b6695bd5f7f0d')}
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_12591ebec554a2" />
          </p>
          <Button
            type="button"
            size="sm"
            onClick={requestDraft}
            disabled={drafting || !draftDescription.trim()}
          >
            <Sparkles size={13} />
            {drafting ? (
              <GeneratedText id="m_11beb293de9d2d" />
            ) : (
              <GeneratedText id="m_191793e41736fc" />
            )}
          </Button>
        </div>
      ) : null}
      <div
        style={{ height }}
        className="overflow-hidden rounded-md border border-slate-300 dark:border-slate-700"
      >
        <Excalidraw
          initialData={
            initialScene ? (initialScene as unknown as ExcalidrawInitialDataState) : undefined
          }
          excalidrawAPI={(api) => {
            apiRef.current = api
          }}
          viewModeEnabled={readOnly}
          handleKeyboardGlobally={false}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              saveAsImage: false,
            },
          }}
        />
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {error ? (
              <span className="text-red-600 dark:text-red-400">
                <GeneratedValue value={error} />
              </span>
            ) : dirty ? (
              <GeneratedText id="m_12aaa3f59baa50" />
            ) : (
              <GeneratedText id="m_030efdd1a1dcd4" />
            )}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearDrawing}
              disabled={saving}
            >
              <Trash2 size={14} /> <GeneratedText id="m_1e4d427e74e767" />
            </Button>
            <Button type="button" size="sm" onClick={saveDrawing} disabled={saving || !dirty}>
              <Save size={14} />
              {saving ? (
                <GeneratedText id="m_106811f2aac664" />
              ) : (
                <GeneratedText id="m_19e6bff894c3c7" />
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
