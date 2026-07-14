'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  Copy,
  CreditCard,
  Eye,
  FileText,
  Grid3X3,
  Loader2,
  Layers3,
  MousePointer2,
  Printer,
  RectangleHorizontal,
  Save,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  DESIGN_DOCUMENT_LIMITS,
  createCertificateDesignDocument,
  createWalletDesignDocument,
  type CredentialDataField,
  type DesignArtboard,
  type DesignDataField,
  type DesignDocument,
  type DesignElement,
} from '@beaconhs/design-studio'
import { Badge, Button, Input, Select, cn } from '@beaconhs/ui'
import {
  ArtboardCanvas,
  CanvasZoomControls,
  Field,
  InsertPanel,
  InspectorPanel,
  LayerToggle,
  LayersPanel,
  PrintPanel,
  RailLabel,
  RailTabButton,
  newElement,
  uniqueElementId,
  useDesignZoom,
  type DesignFieldCatalog,
} from '@/components/design-studio/editor'
import { RawImage } from '@/components/raw-image'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import {
  DEFAULT_CREDENTIAL_OUTPUT,
  DEFAULT_CREDENTIAL_OUTPUTS,
  slugCredentialOutputId,
  type CredentialFormat,
  type CredentialOutput,
} from '@/lib/credential-designs'
import { CREDENTIAL_OUTPUT_LIMITS } from '@/lib/credential-design-write'
import type { SaveCredentialOutputsResult } from './_actions'

const FORMATS: { value: CredentialFormat; label: string; icon: ReactNode }[] = [
  { value: 'letter-landscape', label: '11 x 8.5', icon: <FileText size={14} /> },
  { value: 'letter-portrait', label: '8.5 x 11', icon: <FileText size={14} /> },
  { value: 'wallet', label: 'CR80 card', icon: <CreditCard size={14} /> },
]

const FIELD_OPTIONS: { value: CredentialDataField; label: string }[] = [
  { value: 'tenant.name', label: 'Issuer name' },
  { value: 'tenant.logo', label: 'Issuer logo' },
  { value: 'recipient.fullName', label: 'Recipient name' },
  { value: 'recipient.employeeNo', label: 'Employee number' },
  { value: 'recipient.photo', label: 'Recipient photo' },
  { value: 'credential.name', label: 'Credential name' },
  { value: 'credential.code', label: 'Credential code' },
  { value: 'authority.name', label: 'Authority name' },
  { value: 'completedOn', label: 'Completed date' },
  { value: 'expiresOn', label: 'Expiry date' },
  { value: 'instructor', label: 'Instructor' },
  { value: 'grade', label: 'Grade' },
  { value: 'verify.url', label: 'Verify URL' },
  { value: 'verify.token', label: 'Verify token' },
  { value: 'verify.qr', label: 'Verify QR' },
]

// Keyed as a partial over the shared union: design elements carry
// DesignDataField (credential | equipment), and this studio only samples the
// credential half — the `??` fallbacks at each lookup cover the rest.
const SAMPLE_VALUES: Partial<Record<DesignDataField, string>> = {
  'tenant.name': 'Beacon Health & Safety',
  'tenant.logo': 'Logo',
  'recipient.fullName': 'Avery Chen',
  'recipient.employeeNo': 'BH-1048',
  'recipient.photo': 'Photo',
  'credential.name': 'Confined Space Entry and Monitor',
  'credential.code': 'CSE-201',
  'authority.name': 'Internal Health & Safety',
  completedOn: 'June 11, 2026',
  expiresOn: 'June 11, 2027',
  instructor: 'Morgan Patel',
  grade: '96%',
  'verify.url': 'beacon.example/verify/73b08c2b',
  'verify.token': '73b08c2b3f20f41e',
  'verify.qr': 'QR',
  issuedAt: 'June 11, 2026',
}

const CREDENTIAL_CATALOG: DesignFieldCatalog = {
  options: FIELD_OPTIONS,
  sample: SAMPLE_VALUES,
  defaultField: 'recipient.fullName',
  imageSources: [
    { value: 'tenant.logo', label: 'Issuer logo' },
    { value: 'recipient.photo', label: 'Recipient photo' },
    { value: 'url', label: 'Image URL' },
  ],
}

type RailTab = 'list' | 'design' | 'insert' | 'layers' | 'inspector' | 'print'

export function CredentialDesignStudio({
  initialOutputs,
  onSave,
}: {
  initialOutputs: CredentialOutput[]
  onSave: (outputs: CredentialOutput[]) => Promise<SaveCredentialOutputsResult>
}) {
  const initial = initialOutputs.length ? initialOutputs : DEFAULT_CREDENTIAL_OUTPUTS
  const [outputs, setOutputs] = useState<CredentialOutput[]>(
    initial.map((output) => ensureDocument(output)),
  )
  // null = the design list (landing); an id = that design's full editor.
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [tab, setTab] = useState<RailTab>('design')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const activeOutput = useMemo(
    () => outputs.find((output) => output.id === activeId) ?? null,
    [activeId, outputs],
  )
  const activeDocument = useMemo(
    () => (activeOutput ? documentForOutput(activeOutput) : null),
    [activeOutput],
  )
  const activeArtboard = activeDocument
    ? (activeDocument.artboards.find((artboard) => artboard.id === activeArtboardId) ??
      activeDocument.artboards[0]!)
    : null
  const { viewportRef, zoom, ...zoomControls } = useDesignZoom({
    artboard: activeArtboard,
    reattachKey: activeId,
  })
  const { fullscreen } = zoomControls
  const selectedElement =
    activeArtboard?.elements.find((element) => element.id === selectedElementId) ?? null

  function openDesign(id: string) {
    setActiveId(id)
    setActiveArtboardId(null)
    setSelectedElementId(null)
    setTab('design')
  }

  function updateOutput(id: string, patch: Partial<CredentialOutput>) {
    setOutputs((prev) =>
      prev.map((output) => (output.id === id ? { ...output, ...patch } : output)),
    )
  }

  function updateActive(patch: Partial<CredentialOutput>) {
    if (!activeOutput) return
    updateOutput(activeOutput.id, patch)
  }

  function updateDocument(mutator: (document: DesignDocument) => DesignDocument) {
    const id = activeId
    if (!id) return
    // Mutate against the LATEST state, not the render closure — Fabric can
    // fire several events in one tick (text editing exit fires both
    // `text:editing:exited` and `object:modified`), and closure-based updates
    // would clobber each other.
    setOutputs((prev) =>
      prev.map((output) =>
        output.id === id ? { ...output, document: mutator(documentForOutput(output)) } : output,
      ),
    )
  }

  function updateArtboard(patch: Partial<DesignArtboard>) {
    if (!activeArtboard) return
    updateDocument((document) => ({
      ...document,
      artboards: document.artboards.map((artboard) =>
        artboard.id === activeArtboard.id ? { ...artboard, ...patch } : artboard,
      ),
    }))
  }

  function updateElement(id: string, patch: Partial<DesignElement>) {
    if (!activeArtboard) return
    updateDocument((document) => ({
      ...document,
      artboards: document.artboards.map((artboard) =>
        artboard.id === activeArtboard.id
          ? {
              ...artboard,
              elements: artboard.elements.map((element) =>
                element.id === id ? ({ ...element, ...patch } as DesignElement) : element,
              ),
            }
          : artboard,
      ),
    }))
  }

  function addOutput(format: CredentialFormat) {
    if (outputs.length >= CREDENTIAL_OUTPUT_LIMITS.maxOutputs) {
      toast.error(`Card studio supports up to ${CREDENTIAL_OUTPUT_LIMITS.maxOutputs} designs.`)
      return
    }
    const fallback =
      DEFAULT_CREDENTIAL_OUTPUTS.find((output) => output.format === format) ??
      DEFAULT_CREDENTIAL_OUTPUT
    const baseLabel =
      format === 'wallet'
        ? 'Wallet card'
        : format === 'letter-portrait'
          ? 'Portrait certificate'
          : 'Full-size certificate'
    const label = uniqueOutputName(baseLabel, outputs)
    const output = ensureDocument({
      ...fallback,
      id: uniqueOutputId(slugCredentialOutputId(label), outputs),
      name: label,
      format,
      enabled: true,
      document:
        format === 'wallet'
          ? createWalletDesignDocument(fallback)
          : createCertificateDesignDocument(fallback),
    })
    setOutputs((prev) => [...prev, output])
    openDesign(output.id)
  }

  function duplicateActive() {
    if (!activeOutput || !activeDocument) return
    if (outputs.length >= CREDENTIAL_OUTPUT_LIMITS.maxOutputs) {
      toast.error(`Card studio supports up to ${CREDENTIAL_OUTPUT_LIMITS.maxOutputs} designs.`)
      return
    }
    const name = uniqueOutputName(`${activeOutput.name} copy`, outputs)
    const output = ensureDocument({
      ...activeOutput,
      id: uniqueOutputId(slugCredentialOutputId(name), outputs),
      name,
      enabled: true,
      document: {
        ...activeDocument,
        name,
        artboards: activeDocument.artboards.map((artboard) => ({
          ...artboard,
          elements: artboard.elements.map((element) => ({ ...element })),
        })),
      },
    })
    setOutputs((prev) => [...prev, output])
    openDesign(output.id)
  }

  async function removeActive() {
    if (!activeOutput || outputs.length <= 1) return
    const ok = await confirmDialog({
      message: `Remove the "${activeOutput.name}" design? Records and courses using it fall back to the remaining designs once you save.`,
      confirmLabel: 'Remove design',
      tone: 'danger',
    })
    if (!ok) return
    setOutputs(outputs.filter((output) => output.id !== activeOutput.id))
    setActiveId(null) // back to the design list
  }

  function replaceFormat(format: CredentialFormat) {
    if (!activeOutput) return
    const nextDoc =
      format === 'wallet'
        ? createWalletDesignDocument(activeOutput)
        : createCertificateDesignDocument(activeOutput)
    if (format === 'letter-portrait') {
      nextDoc.artboards = nextDoc.artboards.map((artboard) => ({
        ...artboard,
        format: 'letter-portrait',
        width: 8.5,
        height: 11,
      }))
    }
    updateActive({ format, document: nextDoc })
    setActiveArtboardId(nextDoc.artboards[0]?.id ?? null)
    setSelectedElementId(null)
  }

  function addElement(kind: DesignElement['kind']) {
    if (!activeArtboard) return
    if (activeArtboard.elements.length >= DESIGN_DOCUMENT_LIMITS.maxElementsPerArtboard) {
      toast.error(
        `An artboard can contain up to ${DESIGN_DOCUMENT_LIMITS.maxElementsPerArtboard} elements.`,
      )
      return
    }
    const element = newElement(kind, activeArtboard.elements, CREDENTIAL_CATALOG.defaultField)
    updateArtboard({ elements: [...activeArtboard.elements, element] })
    setSelectedElementId(element.id)
    setTab('inspector')
  }

  function deleteSelected() {
    if (!selectedElement || !activeArtboard) return
    updateArtboard({
      elements: activeArtboard.elements.filter((element) => element.id !== selectedElement.id),
    })
    setSelectedElementId(null)
  }

  function duplicateSelected() {
    if (!selectedElement || !activeArtboard) return
    const clone = {
      ...selectedElement,
      id: uniqueElementId(`${selectedElement.id}-copy`, activeArtboard.elements),
      name: `${selectedElement.name
        .slice(0, DESIGN_DOCUMENT_LIMITS.elementNameLength - ' copy'.length)
        .trimEnd()} copy`,
      x: selectedElement.x + 0.12,
      y: selectedElement.y + 0.12,
    } as DesignElement
    updateArtboard({ elements: [...activeArtboard.elements, clone] })
    setSelectedElementId(clone.id)
  }

  function moveSelected(direction: 'front' | 'back') {
    if (!selectedElement || !activeArtboard) return
    const next = activeArtboard.elements.filter((element) => element.id !== selectedElement.id)
    if (direction === 'front') next.push(selectedElement)
    else next.unshift(selectedElement)
    updateArtboard({ elements: next })
  }

  // Render the CURRENT (possibly unsaved) design through the real PDF
  // pipeline with sample data and open it in a new tab.
  const [previewing, setPreviewing] = useState(false)
  async function previewPdf() {
    if (!activeOutput || previewing) return
    // Open synchronously so the popup isn't blocked, then point it at the blob.
    const win = window.open('about:blank', '_blank')
    setPreviewing(true)
    try {
      const res = await fetch('/training/credential-designs/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output: ensureDocument(activeOutput) }),
      })
      if (!res.ok) {
        const message = (await res.text()).trim().slice(0, 500)
        throw new Error(message || `Preview failed (${res.status})`)
      }
      const url = URL.createObjectURL(await res.blob())
      if (win) win.location.href = url
      else window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      win?.close()
      toast.error(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  function saveDraft() {
    startTransition(async () => {
      try {
        const result = await onSave(outputs.map((output) => ensureDocument(output)))
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        const saved = result.outputs
        setOutputs(saved.map((output) => ensureDocument(output)))
        // Stay where we are: keep the open design if it survived the save,
        // otherwise return to the list.
        setActiveId((current) =>
          current ? (saved.find((output) => output.id === current)?.id ?? null) : null,
        )
        setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      } catch (error) {
        console.error('[credential-designs] save request failed', error)
        toast.error('Credential designs could not be saved. Please try again.')
      }
    })
  }

  return (
    <div
      className={cn(
        'grid overflow-hidden border-slate-200 bg-white lg:grid-cols-[minmax(330px,33%)_1fr] dark:border-slate-800 dark:bg-slate-900',
        fullscreen
          ? 'fixed inset-0 z-50'
          : 'h-[calc(100dvh-236px)] min-h-[520px] rounded-lg border shadow-sm',
      )}
    >
      <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-800">
          {!activeOutput ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Layers3 size={16} className="shrink-0 text-teal-700 dark:text-teal-300" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Card studio
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {outputs.filter((output) => output.enabled).length} active designs
                  </div>
                </div>
              </div>
              <Badge variant="secondary">{outputs.length}</Badge>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  title="All designs"
                  aria-label="Back to all designs"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <ArrowLeft size={15} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {activeOutput.name}
                  </div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {formatLabel(activeOutput.format)}
                  </div>
                </div>
                <Badge variant={activeOutput.enabled ? 'success' : 'secondary'}>
                  {activeOutput.enabled ? 'Active' : 'Hidden'}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-6 gap-1">
                <RailTabButton
                  active={tab === 'list'}
                  label="Designs"
                  onClick={() => setTab('list')}
                  icon={<Layers3 size={14} />}
                />
                <RailTabButton
                  active={tab === 'design'}
                  label="Design"
                  onClick={() => setTab('design')}
                  icon={<Settings2 size={14} />}
                />
                <RailTabButton
                  active={tab === 'insert'}
                  label="Insert"
                  onClick={() => setTab('insert')}
                  icon={<Sparkles size={14} />}
                />
                <RailTabButton
                  active={tab === 'layers'}
                  label="Layers"
                  onClick={() => setTab('layers')}
                  icon={<Layers3 size={14} />}
                />
                <RailTabButton
                  active={tab === 'inspector'}
                  label="Style"
                  onClick={() => setTab('inspector')}
                  icon={<MousePointer2 size={14} />}
                />
                <RailTabButton
                  active={tab === 'print'}
                  label="Print"
                  onClick={() => setTab('print')}
                  icon={<Printer size={14} />}
                />
              </div>
            </>
          )}
        </div>

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {!activeOutput || !activeDocument || !activeArtboard || tab === 'list' ? (
            <DesignListPanel
              outputs={outputs}
              activeId={activeId}
              onOpen={openDesign}
              onAddOutput={addOutput}
            />
          ) : (
            <>
              {tab === 'design' ? (
                <DesignSettingsPanel
                  outputs={outputs}
                  activeOutput={activeOutput}
                  activeDocument={activeDocument}
                  activeArtboard={activeArtboard}
                  onPatchOutput={updateActive}
                  onDuplicate={duplicateActive}
                  onRemove={removeActive}
                  onReplaceFormat={replaceFormat}
                  onSelectArtboard={(id) => setActiveArtboardId(id)}
                />
              ) : null}
              {tab === 'insert' ? <InsertPanel onAdd={addElement} /> : null}
              {tab === 'layers' ? (
                <LayersPanel
                  artboard={activeArtboard}
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
                  artboard={activeArtboard}
                  selectedElement={selectedElement}
                  catalog={CREDENTIAL_CATALOG}
                  onPatchArtboard={updateArtboard}
                  onPatchElement={(patch) =>
                    selectedElement && updateElement(selectedElement.id, patch)
                  }
                  onDelete={deleteSelected}
                />
              ) : null}
              {tab === 'print' ? (
                <PrintPanel artboard={activeArtboard} onPatchArtboard={updateArtboard} />
              ) : null}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Button type="button" className="flex-1" onClick={saveDraft} disabled={pending}>
              <Save size={14} />
              {pending ? 'Saving' : 'Save designs'}
            </Button>
            {savedAt ? (
              <span className="text-xs text-slate-500 dark:text-slate-400">Saved {savedAt}</span>
            ) : null}
          </div>
        </div>
      </aside>

      {!activeOutput || !activeArtboard ? (
        <section className="grid min-h-0 min-w-0 place-items-center bg-slate-100 p-8 dark:bg-slate-950">
          <div className="max-w-sm text-center">
            <CreditCard size={28} className="mx-auto text-slate-300 dark:text-slate-600" />
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Choose a design
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Open a design from the list to edit it on the canvas, or create a new one.
            </p>
          </div>
        </section>
      ) : (
        <section className="flex min-h-0 min-w-0 flex-col bg-slate-100 dark:bg-slate-950">
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {activeOutput.name}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {activeArtboard.name} · {activeArtboard.width}" × {activeArtboard.height}"
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={previewPdf}
                disabled={previewing}
                title="Render this design as a PDF with sample data"
              >
                {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                Preview PDF
              </Button>
              <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setTab('insert')}>
                <Sparkles size={14} /> Insert
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setTab('print')}>
                <Printer size={14} /> Print setup
              </Button>
              <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
              <CanvasZoomControls zoom={zoom} {...zoomControls} />
            </div>
          </div>

          <div ref={viewportRef} className="app-scroll min-h-0 flex-1 overflow-auto p-5">
            <div className="flex min-h-full min-w-fit items-center justify-center">
              <ArtboardCanvas
                key={`${activeOutput.id}:${activeArtboard.id}`}
                artboard={activeArtboard}
                zoom={zoom}
                sample={CREDENTIAL_CATALOG.sample}
                selectedElementId={selectedElementId}
                onSelect={(id, userInitiated) => {
                  setSelectedElementId(id)
                  // Clicking an element jumps straight to its properties.
                  if (id && userInitiated) setTab('inspector')
                }}
                onModify={(id, patch) => updateElement(id, patch)}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

// Landing rail: a straight list of designs — choose one to open its editor.
function DesignListPanel({
  outputs,
  activeId,
  onOpen,
  onAddOutput,
}: {
  outputs: CredentialOutput[]
  activeId?: string | null
  onOpen: (id: string) => void
  onAddOutput: (format: CredentialFormat) => void
}) {
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <RailLabel label={`Designs · ${outputs.length}`} icon={<Layers3 size={14} />} />
        </div>
        <div className="space-y-1.5">
          {outputs.map((output) => {
            const backdrop = firstBackdropUrl(output)
            return (
              <button
                key={output.id}
                type="button"
                onClick={() => onOpen(output.id)}
                aria-current={output.id === activeId}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md border p-2.5 text-left transition-colors',
                  output.id === activeId
                    ? 'border-teal-600 bg-teal-50/60 dark:border-teal-500 dark:bg-teal-950/40'
                    : 'border-slate-200 bg-white hover:border-teal-600 hover:bg-teal-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500 dark:hover:bg-teal-950/30',
                )}
              >
                <span
                  className="relative grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded border"
                  style={
                    backdrop
                      ? { borderColor: output.accent }
                      : {
                          borderColor: output.accent,
                          color: output.primary,
                          backgroundColor: output.paper,
                        }
                  }
                >
                  {backdrop ? (
                    <RawImage
                      src={backdrop}
                      alt=""
                      optimizationReason="design-surface"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : output.format === 'wallet' ? (
                    <CreditCard size={16} />
                  ) : (
                    <FileText size={16} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {output.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {formatLabel(output.format)}
                  </span>
                </span>
                <span
                  className={cn(
                    'h-2.5 w-2.5 shrink-0 rounded-full',
                    output.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-800',
                  )}
                  title={output.enabled ? 'Available from records' : 'Hidden'}
                />
                <ChevronRight size={15} className="shrink-0 text-slate-400 dark:text-slate-500" />
              </button>
            )
          })}
          {outputs.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
              No designs yet — create one below.
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <RailLabel label="Add a design" icon={<Sparkles size={14} />} />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Pick a size to start a new one. Card studio supports up to{' '}
          {CREDENTIAL_OUTPUT_LIMITS.maxOutputs} designs.
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {FORMATS.map((format) => (
            <button
              key={format.value}
              type="button"
              onClick={() => onAddOutput(format.value)}
              disabled={outputs.length >= CREDENTIAL_OUTPUT_LIMITS.maxOutputs}
              className="flex h-14 flex-col items-center justify-center gap-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {format.icon}
              {format.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

// Full menu for the opened design: settings, artboards, format rebuild.
function DesignSettingsPanel({
  outputs,
  activeOutput,
  activeDocument,
  activeArtboard,
  onPatchOutput,
  onDuplicate,
  onRemove,
  onReplaceFormat,
  onSelectArtboard,
}: {
  outputs: CredentialOutput[]
  activeOutput: CredentialOutput
  activeDocument: DesignDocument
  activeArtboard: DesignArtboard
  onPatchOutput: (patch: Partial<CredentialOutput>) => void
  onDuplicate: () => void
  onRemove: () => void
  onReplaceFormat: (format: CredentialFormat) => void
  onSelectArtboard: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <RailLabel label="Design" icon={<BadgeCheck size={14} />} />
        <Field label="Name">
          <Input
            value={activeOutput.name}
            maxLength={CREDENTIAL_OUTPUT_LIMITS.nameLength}
            onChange={(e) => onPatchOutput({ name: e.currentTarget.value })}
          />
        </Field>
        <Field label="Description">
          <Input
            value={activeOutput.description}
            maxLength={CREDENTIAL_OUTPUT_LIMITS.descriptionLength}
            onChange={(e) => onPatchOutput({ description: e.currentTarget.value })}
          />
        </Field>
        <LayerToggle
          checked={activeOutput.enabled}
          label="Available from records"
          onChange={(enabled) => onPatchOutput({ enabled })}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={onDuplicate}>
            <Copy size={14} /> Duplicate
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemove}
            disabled={outputs.length <= 1}
          >
            <Trash2 size={14} /> Remove
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <RailLabel label="Artboards" icon={<Grid3X3 size={14} />} />
        <div className="grid grid-cols-2 gap-1.5">
          {activeDocument.artboards.map((artboard) => (
            <button
              key={artboard.id}
              type="button"
              onClick={() => onSelectArtboard(artboard.id)}
              className={cn(
                'rounded-md border px-2 py-2 text-left text-xs',
                artboard.id === activeArtboard.id
                  ? 'border-teal-700 bg-teal-50 text-teal-900 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-200'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
              )}
            >
              <div className="font-semibold">{artboard.name}</div>
              <div className="text-[11px]">
                {artboard.width}" × {artboard.height}"
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <RailLabel label="Rebuild as" icon={<RectangleHorizontal size={14} />} />
        <div className="grid grid-cols-3 gap-1.5">
          {FORMATS.map((format) => (
            <button
              key={format.value}
              type="button"
              onClick={() => onReplaceFormat(format.value)}
              className={cn(
                'flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-xs font-medium',
                activeOutput.format === format.value
                  ? 'border-teal-700 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {format.icon}
              {format.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function ensureDocument(output: CredentialOutput): CredentialOutput {
  return {
    ...output,
    document: documentForOutput(output),
  }
}

function documentForOutput(output: CredentialOutput): DesignDocument {
  if (output.document) return output.document
  return output.format === 'wallet'
    ? createWalletDesignDocument(output)
    : createCertificateDesignDocument(output)
}

function uniqueOutputId(base: string, outputs: CredentialOutput[]) {
  const used = new Set(outputs.map((output) => output.id))
  const boundedBase = base.slice(0, CREDENTIAL_OUTPUT_LIMITS.idLength)
  let id = boundedBase
  let i = 2
  while (used.has(id)) {
    const suffix = `-${i}`
    id = `${boundedBase.slice(0, CREDENTIAL_OUTPUT_LIMITS.idLength - suffix.length)}${suffix}`
    i += 1
  }
  return id
}

function uniqueOutputName(base: string, outputs: CredentialOutput[]) {
  const used = new Set(outputs.map((output) => output.name))
  const boundedBase = base.slice(0, CREDENTIAL_OUTPUT_LIMITS.nameLength).trimEnd()
  if (!used.has(boundedBase)) return boundedBase
  let i = 2
  let candidate = boundedBase
  while (used.has(candidate)) {
    const suffix = ` ${i}`
    candidate = `${boundedBase
      .slice(0, CREDENTIAL_OUTPUT_LIMITS.nameLength - suffix.length)
      .trimEnd()}${suffix}`
    i += 1
  }
  return candidate
}

// Thumbnail source for the design list: the first full-bleed URL image on the
// front artboard (the baked card artwork), if any.
function firstBackdropUrl(output: CredentialOutput): string | null {
  const artboard = output.document?.artboards?.[0]
  if (!artboard) return null
  for (const element of artboard.elements) {
    if (
      element.kind === 'image' &&
      element.source === 'url' &&
      element.url &&
      element.x <= 0.06 &&
      element.y <= 0.06 &&
      element.width >= artboard.width * 0.9 &&
      element.height >= artboard.height * 0.9
    ) {
      return element.url
    }
  }
  return null
}

function formatLabel(format: CredentialFormat) {
  if (format === 'wallet') return 'CR80 wallet card'
  if (format === 'letter-portrait') return 'Letter portrait'
  return 'Letter landscape'
}
