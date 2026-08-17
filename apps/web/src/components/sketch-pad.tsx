'use client'

import { GeneratedText, GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'

// SketchPad — a comprehensive freehand drawing / diagram canvas built on
// Excalidraw (shapes, arrows, text, freehand, images). Used by the form
// `sketch` element (e.g. a lift-plan diagram). Outputs a PNG data-url plus the
// editable Excalidraw scene so the drawing can be re-opened and amended.
//
// Excalidraw touches `window` at module scope, so it is loaded via
// `next/dynamic` with `ssr: false`. The heavy bundle only downloads when a
// sketch element actually renders.

import { useCallback, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Save, Trash2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'
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
