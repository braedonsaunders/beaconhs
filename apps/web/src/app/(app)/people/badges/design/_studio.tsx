'use client'

// Person ID-badge design studio — the same canvas editor the training
// credential and equipment-label designers use (shared parts in
// @/components/design-studio), composed for the ONE two-sided tenant badge
// document. Front and back are separate artboards; the QR opens the person's
// public live training transcript.

import { useMemo, useState, useTransition } from 'react'
import {
  IdCard,
  Layers,
  MousePointerClick,
  Printer,
  RotateCcw,
  Save,
  Shapes,
  SlidersHorizontal,
} from 'lucide-react'
import { Button, cn } from '@beaconhs/ui'
import type { DesignDocument, DesignElement } from '@beaconhs/design-studio'
import {
  ArtboardCanvas,
  CanvasZoomControls,
  InsertPanel,
  InspectorPanel,
  LayersPanel,
  PrintPanel,
  RailLabel,
  RailTabButton,
  newElement,
  uniqueElementId,
  useDesignZoom,
  type DesignFieldCatalog,
} from '@/components/design-studio/editor'
import { confirmDialog } from '@/lib/confirm'

const CATALOG: DesignFieldCatalog = {
  options: [
    { value: 'tenant.name', label: 'Company name' },
    { value: 'recipient.fullName', label: 'Person name' },
    { value: 'recipient.employeeNo', label: 'Employee number' },
    { value: 'person.title', label: 'Job title' },
    { value: 'person.department', label: 'Department' },
    { value: 'issuedAt', label: 'Issued date' },
    { value: 'verify.url', label: 'Transcript URL' },
    { value: 'verify.qr', label: 'Transcript QR code' },
  ],
  sample: {
    'tenant.name': 'Beacon Health & Safety',
    'recipient.fullName': 'Jordan Miller',
    'recipient.employeeNo': '10482',
    'person.title': 'Mechanical Foreman',
    'person.department': 'Field Services',
    issuedAt: '2026-07-10',
    'verify.url': 'https://app.example.com/verify/person/abc123',
    'verify.qr': 'QR',
  },
  defaultField: 'recipient.fullName',
  imageSources: [
    { value: 'tenant.logo', label: 'Company logo' },
    { value: 'recipient.photo', label: 'Person photo' },
    { value: 'url', label: 'Image URL' },
  ],
}

type RailTab = 'insert' | 'layers' | 'inspector' | 'print'

export function PersonBadgeStudio({
  initialDocument,
  onSave,
  onReset,
}: {
  initialDocument: DesignDocument
  onSave: (document: DesignDocument) => Promise<DesignDocument>
  onReset: () => Promise<DesignDocument>
}) {
  const [doc, setDoc] = useState<DesignDocument>(initialDocument)
  const [artboardIndex, setArtboardIndex] = useState(0)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [tab, setTab] = useState<RailTab>('inspector')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const artboard = doc.artboards[Math.min(artboardIndex, doc.artboards.length - 1)]!
  const selectedElement = useMemo(
    () => artboard.elements.find((e) => e.id === selectedElementId) ?? null,
    [artboard.elements, selectedElementId],
  )

  const { viewportRef, zoom, ...zoomControls } = useDesignZoom({ artboard, reattachKey: doc })

  function patchArtboard(patch: Partial<typeof artboard>) {
    setDoc((prev) => ({
      ...prev,
      artboards: prev.artboards.map((a) => (a.id === artboard.id ? { ...a, ...patch } : a)),
    }))
  }

  function patchElement(id: string, patch: Partial<DesignElement>) {
    patchArtboard({
      elements: artboard.elements.map((e) =>
        e.id === id ? ({ ...e, ...patch } as DesignElement) : e,
      ),
    })
  }

  function addElement(kind: DesignElement['kind']) {
    const element = newElement(kind, artboard.elements, CATALOG.defaultField)
    patchArtboard({ elements: [...artboard.elements, element] })
    setSelectedElementId(element.id)
    setTab('inspector')
  }

  function duplicateSelected() {
    if (!selectedElement) return
    const copy = {
      ...selectedElement,
      id: uniqueElementId(selectedElement.kind, artboard.elements),
      x: selectedElement.x + 0.1,
      y: selectedElement.y + 0.1,
    }
    patchArtboard({ elements: [...artboard.elements, copy] })
    setSelectedElementId(copy.id)
  }

  function deleteSelected() {
    if (!selectedElement) return
    patchArtboard({ elements: artboard.elements.filter((e) => e.id !== selectedElement.id) })
    setSelectedElementId(null)
  }

  function moveSelected(dir: 'front' | 'back') {
    if (!selectedElement) return
    const rest = artboard.elements.filter((e) => e.id !== selectedElement.id)
    patchArtboard({
      elements: dir === 'front' ? [...rest, selectedElement] : [selectedElement, ...rest],
    })
  }

  function selectArtboard(index: number) {
    setArtboardIndex(index)
    setSelectedElementId(null)
  }

  function save() {
    setError(null)
    startTransition(async () => {
      try {
        const saved = await onSave(doc)
        setDoc(saved)
        setSavedAt(new Date().toLocaleTimeString())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed')
      }
    })
  }

  function reset() {
    setError(null)
    void confirmDialog({
      message:
        'Reset the ID badge to the default design? Your saved layout is replaced immediately.',
      confirmLabel: 'Reset design',
      tone: 'danger',
    }).then((ok) => {
      if (!ok) return
      startTransition(async () => {
        try {
          const fresh = await onReset()
          setDoc(fresh)
          setArtboardIndex(0)
          setSelectedElementId(null)
          setSavedAt(new Date().toLocaleTimeString())
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Reset failed')
        }
      })
    })
  }

  return (
    <div className="grid min-h-[70vh] grid-cols-[300px_1fr] overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <aside className="flex min-h-0 flex-col border-r border-slate-200 dark:border-slate-800">
        <div className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-800">
          <RailLabel icon={<IdCard size={13} />} label="ID badge" />
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {doc.artboards.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => selectArtboard(i)}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs font-medium',
                  i === artboardIndex
                    ? 'border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-400 dark:bg-teal-500/10 dark:text-teal-300'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                {a.name}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <RailTabButton
              active={tab === 'inspector'}
              label="Design"
              icon={<SlidersHorizontal size={14} />}
              onClick={() => setTab('inspector')}
            />
            <RailTabButton
              active={tab === 'insert'}
              label="Insert"
              icon={<Shapes size={14} />}
              onClick={() => setTab('insert')}
            />
            <RailTabButton
              active={tab === 'layers'}
              label="Layers"
              icon={<Layers size={14} />}
              onClick={() => setTab('layers')}
            />
            <RailTabButton
              active={tab === 'print'}
              label="Print"
              icon={<Printer size={14} />}
              onClick={() => setTab('print')}
            />
          </div>
        </div>

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {tab === 'insert' ? <InsertPanel onAdd={addElement} /> : null}
          {tab === 'layers' ? (
            <LayersPanel
              artboard={artboard}
              selectedElementId={selectedElementId}
              onSelect={(id) => {
                setSelectedElementId(id)
                setTab('inspector')
              }}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
              onFront={() => moveSelected('front')}
              onBack={() => moveSelected('back')}
            />
          ) : null}
          {tab === 'inspector' ? (
            <InspectorPanel
              artboard={artboard}
              selectedElement={selectedElement}
              catalog={CATALOG}
              onPatchArtboard={patchArtboard}
              onPatchElement={(patch) => selectedElement && patchElement(selectedElement.id, patch)}
              onDelete={deleteSelected}
            />
          ) : null}
          {tab === 'print' ? (
            <PrintPanel artboard={artboard} onPatchArtboard={patchArtboard} />
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Button type="button" className="flex-1" onClick={save} disabled={pending}>
              <Save size={14} />
              {pending ? 'Saving' : 'Save badge design'}
            </Button>
            <Button type="button" variant="outline" onClick={reset} disabled={pending}>
              <RotateCcw size={14} />
            </Button>
          </div>
          {savedAt ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Saved {savedAt}</p>
          ) : null}
          {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
          <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <MousePointerClick size={11} /> Click an element on the badge to edit it.
          </p>
        </div>
      </aside>

      <section
        ref={viewportRef}
        className="relative grid min-h-0 min-w-0 place-items-center overflow-auto bg-slate-100 p-5 dark:bg-slate-950"
      >
        <div className="rounded-lg bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#f1f5f9_0%_50%)] bg-[length:22px_22px] p-8 shadow-inner dark:bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)]">
          <ArtboardCanvas
            artboard={artboard}
            zoom={zoom}
            sample={CATALOG.sample}
            selectedElementId={selectedElementId}
            onSelect={(id, userInitiated) => {
              setSelectedElementId(id)
              if (userInitiated && id) setTab('inspector')
            }}
            onModify={patchElement}
          />
        </div>
        <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-md border border-slate-200 bg-white/95 px-1.5 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
          <CanvasZoomControls zoom={zoom} {...zoomControls} />
        </div>
      </section>
    </div>
  )
}
