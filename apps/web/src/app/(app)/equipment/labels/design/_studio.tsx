'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Equipment QR-label design studio — the same canvas editor the training
// credential designer uses (shared parts in @/components/design-studio),
// composed for the ONE tenant label document. Every visual aspect is
// user-editable: artboard size (4×6 preset or fully custom), every element,
// every data binding. The default uses a thermal-label layout.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Layers,
  MousePointerClick,
  Printer,
  Save,
  Shapes,
  SlidersHorizontal,
  Tag,
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

const CATALOG: DesignFieldCatalog = {
  options: [
    { value: 'tenant.name', label: 'Company name' },
    { value: 'equipment.name', label: 'Equipment name' },
    { value: 'equipment.assetTag', label: 'Asset tag' },
    { value: 'equipment.serial', label: 'Serial number' },
    { value: 'equipment.class', label: 'Class (category • type)' },
    { value: 'equipment.division', label: 'Site / division' },
    { value: 'equipment.lastInspection', label: 'Last inspection' },
    { value: 'equipment.nextInspectionDue', label: 'Next inspection due' },
    { value: 'verify.url', label: 'Scan URL' },
    { value: 'verify.qr', label: 'Scan QR code' },
  ],
  sample: {
    'tenant.name': 'Beacon Health & Safety',
    'equipment.name': 'Genie Z45/25J RT Boom Lift',
    'equipment.assetTag': 'LIF6',
    'equipment.serial': 'Z452515A-48291',
    'equipment.class': 'Lifts • Articulating boom',
    'equipment.division': 'Field Services',
    'equipment.lastInspection': '2026-06-24',
    'equipment.nextInspectionDue': '2026-09-24',
    'verify.url': 'https://app.example.com/equipment/scan/abc123',
    'verify.qr': 'QR',
  },
  defaultField: 'equipment.name',
  imageSources: [
    { value: 'tenant.logo', label: 'Company logo' },
    { value: 'url', label: 'Image URL' },
  ],
}

type RailTab = 'insert' | 'layers' | 'inspector' | 'print'

export function EquipmentLabelStudio({
  initialDocument,
  onSave,
}: {
  initialDocument: DesignDocument
  onSave: (document: DesignDocument) => Promise<DesignDocument>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [doc, setDoc] = useState<DesignDocument>(initialDocument)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [tab, setTab] = useState<RailTab>('inspector')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const artboard = doc.artboards[0]!
  const selectedElement = useMemo(
    () => artboard.elements.find((e) => e.id === selectedElementId) ?? null,
    [artboard.elements, selectedElementId],
  )

  const { viewportRef, zoom, ...zoomControls } = useDesignZoom({
    artboard,
    reattachKey: doc,
    viewportPadding: 104,
  })

  function patchArtboard(patch: Partial<typeof artboard>) {
    setDoc((prev) => ({
      ...prev,
      artboards: prev.artboards.map((a, i) => (i === 0 ? { ...a, ...patch } : a)),
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

  function save() {
    setError(tGeneratedValue(null))
    startTransition(async () => {
      try {
        const saved = await onSave(doc)
        setDoc(saved)
        setSavedAt(new Date().toLocaleTimeString())
      } catch (e) {
        setError(tGeneratedValue(e instanceof Error ? e.message : tGenerated('m_0731204fbd1b17')))
      }
    })
  }

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden bg-white dark:bg-slate-900',
        zoomControls.fullscreen ? 'fixed inset-0 z-50' : 'h-full flex-1',
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <Button asChild variant="ghost" size="sm">
          <Link
            href="/equipment/manage"
            aria-label={tGenerated('m_03400a3339c089')}
            title={tGenerated('m_03400a3339c089')}
          >
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          <GeneratedText id="m_0f44d475f864cd" />
        </h1>
        <span role="status" className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
          {savedAt ? (
            <>
              <GeneratedText id="m_0a0569b726b225" /> {savedAt}
            </>
          ) : null}
        </span>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          <Save size={14} />
          <GeneratedText id={pending ? 'm_049969c97f8439' : 'm_1d500dc60e3e5d'} />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="shrink-0 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
        <aside className="flex max-h-[40%] min-h-0 shrink-0 flex-col border-b border-slate-200 sm:max-h-none sm:w-[300px] sm:border-r sm:border-b-0 dark:border-slate-800">
          <div className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-800">
            <RailLabel icon={<Tag size={13} />} label={tGenerated('m_1f849ca368e9ff')} />
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <RailTabButton
                active={tab === 'inspector'}
                label={tGenerated('m_0006b9b63f781f')}
                icon={<SlidersHorizontal size={14} />}
                onClick={() => setTab('inspector')}
              />
              <RailTabButton
                active={tab === 'insert'}
                label={tGenerated('m_028b340e5141ab')}
                icon={<Shapes size={14} />}
                onClick={() => setTab('insert')}
              />
              <RailTabButton
                active={tab === 'layers'}
                label={tGenerated('m_1065741cf2a494')}
                icon={<Layers size={14} />}
                onClick={() => setTab('layers')}
              />
              <RailTabButton
                active={tab === 'print'}
                label={tGenerated('m_124553ef26fbe5')}
                icon={<Printer size={14} />}
                onClick={() => setTab('print')}
              />
            </div>
          </div>

          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
            <GeneratedValue value={tab === 'insert' ? <InsertPanel onAdd={addElement} /> : null} />
            <GeneratedValue
              value={
                tab === 'layers' ? (
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
                ) : null
              }
            />
            <GeneratedValue
              value={
                tab === 'inspector' ? (
                  <InspectorPanel
                    artboard={artboard}
                    selectedElement={selectedElement}
                    catalog={CATALOG}
                    onPatchArtboard={patchArtboard}
                    onPatchElement={(patch) =>
                      selectedElement && patchElement(selectedElement.id, patch)
                    }
                    onDelete={deleteSelected}
                  />
                ) : null
              }
            />
            <GeneratedValue
              value={
                tab === 'print' ? (
                  <PrintPanel artboard={artboard} onPatchArtboard={patchArtboard} />
                ) : null
              }
            />
          </div>

          <div className="hidden shrink-0 border-t border-slate-200 px-3 py-2 sm:block dark:border-slate-800">
            <p className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <MousePointerClick size={11} /> <GeneratedText id="m_1dca6cb7d67754" />
            </p>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-100 dark:bg-slate-950">
          <div className="flex shrink-0 justify-end border-b border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
            <CanvasZoomControls zoom={zoom} {...zoomControls} />
          </div>
          <div ref={viewportRef} className="app-scroll min-h-0 min-w-0 flex-1 overflow-auto p-5">
            <div className="flex min-h-full w-max min-w-full">
              <div className="m-auto shrink-0">
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
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
