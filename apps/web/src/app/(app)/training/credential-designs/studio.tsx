'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  BadgeCheck,
  BringToFront,
  ChevronRight,
  Copy,
  CreditCard,
  Eye,
  FileText,
  Grid3X3,
  Loader2,
  Image as ImageIcon,
  Layers3,
  Lock,
  Maximize2,
  Minimize2,
  MousePointer2,
  Printer,
  QrCode,
  RectangleHorizontal,
  Save,
  Scan,
  SendToBack,
  Settings2,
  Sparkles,
  Trash2,
  Type,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  PRINT_PROVIDERS,
  createCertificateDesignDocument,
  createWalletDesignDocument,
  type ArtboardFormat,
  type CredentialDataField,
  type DesignArtboard,
  type DesignDocument,
  type DesignElement,
  type PrintProvider,
} from '@beaconhs/design-studio'
import { loadFabric } from '@beaconhs/design-studio/fabric'
import { Badge, Button, Input, Label, Select, Textarea, cn } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import {
  DEFAULT_CREDENTIAL_OUTPUT,
  DEFAULT_CREDENTIAL_OUTPUTS,
  slugCredentialOutputId,
  type CredentialFormat,
  type CredentialOutput,
} from '@/lib/credential-designs'

const PPI = 96

const ZOOM_MIN = 0.1
const ZOOM_MAX = 4
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 1000) / 1000))

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

const SAMPLE_VALUES: Record<CredentialDataField, string> = {
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

// Shown at the top of the inspector so a selected element explains itself.
const KIND_META: Record<DesignElement['kind'], { label: string; hint: string }> = {
  text: {
    label: 'Text box',
    hint: 'Fixed text — prints exactly what you type. Double-click it on the canvas to edit inline, or use the Text field below.',
  },
  field: {
    label: 'Data field',
    hint: 'Live placeholder — filled with the record’s data (name, dates, course…) each time a certificate or card is generated.',
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
    hint: 'Placeholder box — replaced with the issuer logo or recipient photo when the credential is generated.',
  },
  qr: {
    label: 'Verification QR',
    hint: 'Generated per credential — scanning it opens the public verification page for that record.',
  },
  seal: {
    label: 'Seal',
    hint: 'Round badge — stamps your text (or the issuer’s initials when left blank).',
  },
}

type RailTab = 'list' | 'design' | 'insert' | 'layers' | 'inspector' | 'print'

export function CredentialDesignStudio({
  initialOutputs,
  onSave,
}: {
  initialOutputs: CredentialOutput[]
  onSave: (outputs: CredentialOutput[]) => Promise<CredentialOutput[]>
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

  // --- canvas viewport: zoom / fit-to-window / fullscreen ---
  const viewportRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [fitMode, setFitMode] = useState(true) // recompute zoom to fit on resize
  const [fullscreen, setFullscreen] = useState(false)

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
  const selectedElement =
    activeArtboard?.elements.find((element) => element.id === selectedElementId) ?? null

  function openDesign(id: string) {
    setActiveId(id)
    setSelectedElementId(null)
    setTab('design')
  }

  useEffect(() => {
    if (!activeDocument) return
    setActiveArtboardId((current) =>
      activeDocument.artboards.some((artboard) => artboard.id === current)
        ? current
        : (activeDocument.artboards[0]?.id ?? null),
    )
    setSelectedElementId(null)
  }, [activeDocument])

  // Fit the artboard to the visible viewport (the chrome around the canvas —
  // outer p-5 + checkered p-8 — is ~120px per axis). ResizeObserver fires once
  // on observe, so switching artboards/fullscreen re-fits immediately.
  const computeFit = useCallback(() => {
    const vp = viewportRef.current
    if (!vp || !activeArtboard) return 1
    const availW = Math.max(vp.clientWidth - 120, 80)
    const availH = Math.max(vp.clientHeight - 120, 80)
    return clampZoom(
      Math.min(availW / (activeArtboard.width * PPI), availH / (activeArtboard.height * PPI)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArtboard?.width, activeArtboard?.height])

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

  // Ctrl/⌘ + scroll (and trackpad pinch) zooms the canvas — native listener
  // because React's synthetic wheel handlers are passive. Re-attached per
  // design since the viewport only exists while one is open.
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
  }, [activeId])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

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

  function removeActive() {
    if (!activeOutput || outputs.length <= 1) return
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
    const element = newElement(kind, activeArtboard.elements)
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
      name: `${selectedElement.name} copy`,
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
      if (!res.ok) throw new Error(`Preview failed (${res.status})`)
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
      const saved = await onSave(outputs.map((output) => ensureDocument(output)))
      setOutputs(saved.map((output) => ensureDocument(output)))
      // Stay where we are: keep the open design if it survived the save,
      // otherwise return to the list.
      setActiveId((current) =>
        current ? (saved.find((output) => output.id === current)?.id ?? null) : null,
      )
      setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => zoomBy(1 / 1.2)}
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
                title="Zoom out (⌘ + scroll)"
              >
                <ZoomOut size={14} />
              </Button>
              <button
                type="button"
                onClick={() => zoomTo(1)}
                title="Zoom to 100%"
                className="w-12 rounded px-1 py-1 text-center text-xs font-medium text-slate-600 tabular-nums hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => zoomBy(1.2)}
                disabled={zoom >= ZOOM_MAX}
                aria-label="Zoom in"
                title="Zoom in (⌘ + scroll)"
              >
                <ZoomIn size={14} />
              </Button>
              <Button
                type="button"
                variant={fitMode ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFitMode(true)}
                aria-label="Fit to window"
                title="Fit to window"
              >
                <Scan size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFullscreen((v) => !v)}
                aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </Button>
            </div>
          </div>

          <div ref={viewportRef} className="app-scroll min-h-0 flex-1 overflow-auto p-5">
            <div className="flex min-h-full min-w-fit items-center justify-center">
              <ArtboardCanvas
                key={`${activeOutput.id}:${activeArtboard.id}`}
                artboard={activeArtboard}
                zoom={zoom}
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

function ArtboardCanvas({
  artboard,
  zoom,
  selectedElementId,
  onSelect,
  onModify,
}: {
  artboard: DesignArtboard
  zoom: number
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

  useEffect(() => {
    let disposed = false
    loadFabric().then((fabric) => {
      if (disposed || !canvasRef.current) return
      fabricRef.current = fabric
      const canvas = new fabric.Canvas(canvasRef.current, {
        preserveObjectStacking: true,
        backgroundColor: artboard.background,
        selection: true,
      })
      canvasInstanceRef.current = canvas
      canvas.on('selection:created', (event: any) =>
        onSelect(idForObject(event.selected?.[0]), !!event.e),
      )
      canvas.on('selection:updated', (event: any) =>
        onSelect(idForObject(event.selected?.[0]), !!event.e),
      )
      canvas.on('selection:cleared', (event: any) => onSelect(null, !!event.e))
      canvas.on('object:modified', (event: any) => {
        const object = event.target
        const id = idForObject(object)
        if (!id || !object) return
        onModify(id, objectPatch(object, PPI * zoomRef.current))
      })
      // Inline canvas text editing (double-click on a text box) — persist the
      // typed text back into the element, or it reverts on the next rebuild.
      canvas.on('text:editing:exited', (event: any) => {
        const object = event.target
        const id = idForObject(object)
        if (!id || !object) return
        onModify(id, {
          ...objectPatch(object, PPI * zoomRef.current),
          text: object.text ?? '',
        } as Partial<DesignElement>)
      })
      renderFabricArtboard(fabric, canvas, artboard, selectedElementId, zoomRef.current, getImage)
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
    renderFabricArtboard(fabric, canvas, artboard, selectedElementId, zoom, getImage)
  }, [artboard, selectedElementId, zoom, getImage, imageTick])

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
    const object = fabricObject(fabric, element, k, getImage)
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
    return new fabric.Textbox(displayTextForElement(element), {
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

function displayTextForElement(element: DesignElement): string {
  if (element.kind === 'text') return element.text
  if (element.kind === 'field')
    return `${element.prefix ?? ''}${SAMPLE_VALUES[element.field] ?? element.fallback ?? element.field}${element.suffix ?? ''}`
  return element.name
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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={backdrop}
                      alt=""
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
          Add as many as you need — pick a size to start a new one.
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {FORMATS.map((format) => (
            <button
              key={format.value}
              type="button"
              onClick={() => onAddOutput(format.value)}
              className="flex h-14 flex-col items-center justify-center gap-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
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
            onChange={(e) => onPatchOutput({ name: e.currentTarget.value })}
          />
        </Field>
        <Field label="Description">
          <Input
            value={activeOutput.description}
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

function InsertPanel({ onAdd }: { onAdd: (kind: DesignElement['kind']) => void }) {
  return (
    <div className="space-y-3">
      <RailLabel label="Add elements" icon={<Sparkles size={14} />} />
      <ElementButton label="Text box" icon={<Type size={15} />} onClick={() => onAdd('text')} />
      <ElementButton
        label="Data field"
        icon={<BadgeCheck size={15} />}
        onClick={() => onAdd('field')}
      />
      <ElementButton
        label="Shape"
        icon={<RectangleHorizontal size={15} />}
        onClick={() => onAdd('rect')}
      />
      <ElementButton
        label="Ellipse / seal base"
        icon={<BadgeCheck size={15} />}
        onClick={() => onAdd('ellipse')}
      />
      <ElementButton
        label="Image placeholder"
        icon={<ImageIcon size={15} />}
        onClick={() => onAdd('image')}
      />
      <ElementButton
        label="Verification QR"
        icon={<QrCode size={15} />}
        onClick={() => onAdd('qr')}
      />
      <ElementButton label="Seal" icon={<BadgeCheck size={15} />} onClick={() => onAdd('seal')} />
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
        Fields bind to live record data at render time. Moving or editing them here changes every
        future PDF without storing generated files.
      </div>
    </div>
  )
}

function LayersPanel({
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
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <RailLabel label="Layers" icon={<Layers3 size={14} />} />
        <Badge variant="secondary">{artboard.elements.length}</Badge>
      </div>
      <div className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDuplicate}
          disabled={!selectedElementId}
          title="Duplicate"
        >
          <Copy size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onFront}
          disabled={!selectedElementId}
          title="Bring forward"
        >
          <BringToFront size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          disabled={!selectedElementId}
          title="Send backward"
        >
          <SendToBack size={14} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={!selectedElementId}
          title="Delete"
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <div className="space-y-1.5">
        {[...artboard.elements].reverse().map((element) => (
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
            {iconForElement(element)}
            <span className="min-w-0 flex-1 truncate">{element.name}</span>
            {element.locked ? (
              <Lock size={12} className="text-slate-400 dark:text-slate-500" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}

function InspectorPanel({
  artboard,
  selectedElement,
  onPatchArtboard,
  onPatchElement,
  onDelete,
}: {
  artboard: DesignArtboard
  selectedElement: DesignElement | null
  onPatchArtboard: (patch: Partial<DesignArtboard>) => void
  onPatchElement: (patch: Partial<DesignElement>) => void
  onDelete: () => void
}) {
  if (!selectedElement) {
    return (
      <div className="space-y-3">
        <RailLabel label="Artboard" icon={<Grid3X3 size={14} />} />
        <Field label="Name">
          <Input
            value={artboard.name}
            onChange={(e) => onPatchArtboard({ name: e.currentTarget.value })}
          />
        </Field>
        <ColorField
          label="Background"
          value={artboard.background}
          onChange={(background) => onPatchArtboard({ background })}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Width"
            value={artboard.width}
            onChange={(width) => onPatchArtboard({ width })}
          />
          <NumberField
            label="Height"
            value={artboard.height}
            onChange={(height) => onPatchArtboard({ height })}
          />
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
          Select a layer or click an object on the artboard to edit its position, content, and
          styling.
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
            {iconForElement(selectedElement)}
            {meta.label}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label="Delete element"
          >
            <Trash2 size={14} className="text-rose-500" />
          </Button>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{meta.hint}</p>
      </div>

      <Field label="Layer name">
        <Input
          value={selectedElement.name}
          onChange={(e) => onPatchElement({ name: e.currentTarget.value })}
        />
      </Field>

      {selectedElement.kind === 'text' ? (
        <Field label="Text">
          <Textarea
            rows={3}
            value={selectedElement.text}
            onChange={(e) =>
              onPatchElement({ text: e.currentTarget.value } as Partial<DesignElement>)
            }
          />
        </Field>
      ) : null}

      {selectedElement.kind === 'field' ? (
        <>
          <Field label="Data field">
            <Select
              value={selectedElement.field}
              onChange={(e) =>
                onPatchElement({
                  field: e.currentTarget.value as CredentialDataField,
                } as Partial<DesignElement>)
              }
            >
              {FIELD_OPTIONS.map((field) => (
                <option key={field.value} value={field.value}>
                  {field.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="rounded-md border border-teal-100 bg-teal-50/60 px-2.5 py-2 text-xs text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200">
            <span className="font-semibold">Sample:</span>{' '}
            {`${selectedElement.prefix ?? ''}${
              selectedElement.transform === 'uppercase'
                ? (SAMPLE_VALUES[selectedElement.field] ?? '').toUpperCase()
                : (SAMPLE_VALUES[selectedElement.field] ?? '')
            }${selectedElement.suffix ?? ''}`}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Prefix">
              <Input
                value={selectedElement.prefix ?? ''}
                onChange={(e) =>
                  onPatchElement({ prefix: e.currentTarget.value } as Partial<DesignElement>)
                }
              />
            </Field>
            <Field label="Suffix">
              <Input
                value={selectedElement.suffix ?? ''}
                onChange={(e) =>
                  onPatchElement({ suffix: e.currentTarget.value } as Partial<DesignElement>)
                }
              />
            </Field>
            <Field label="If empty, show">
              <Input
                value={selectedElement.fallback ?? ''}
                placeholder="leave blank to hide"
                onChange={(e) =>
                  onPatchElement({ fallback: e.currentTarget.value } as Partial<DesignElement>)
                }
              />
            </Field>
            <Field label="Format">
              <Select
                value={selectedElement.transform ?? 'none'}
                onChange={(e) =>
                  onPatchElement({
                    transform: e.currentTarget.value as
                      | 'none'
                      | 'uppercase'
                      | 'date-long'
                      | 'date-short',
                  } as Partial<DesignElement>)
                }
              >
                <option value="none">As is</option>
                <option value="uppercase">UPPERCASE</option>
                <option value="date-long">Date — June 11, 2026</option>
                <option value="date-short">Date — Jun 11, 2026</option>
              </Select>
            </Field>
          </div>
        </>
      ) : null}

      {selectedElement.kind === 'image' ? (
        <>
          <Field label="Image source">
            <Select
              value={selectedElement.source}
              onChange={(e) =>
                onPatchElement({ source: e.currentTarget.value as any } as Partial<DesignElement>)
              }
            >
              <option value="tenant.logo">Issuer logo</option>
              <option value="recipient.photo">Recipient photo</option>
              <option value="url">Image URL</option>
            </Select>
          </Field>
          {selectedElement.source === 'url' ? (
            <Field label="Image URL">
              <Input
                value={selectedElement.url ?? ''}
                placeholder="https://…"
                onChange={(e) =>
                  onPatchElement({ url: e.currentTarget.value } as Partial<DesignElement>)
                }
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {selectedElement.kind === 'seal' ? (
        <Field label="Seal text">
          <Input
            value={selectedElement.text ?? ''}
            placeholder="Issuer initials when blank"
            onChange={(e) =>
              onPatchElement({ text: e.currentTarget.value } as Partial<DesignElement>)
            }
          />
        </Field>
      ) : null}

      {selectedElement.kind === 'qr' ? (
        <div className="grid grid-cols-1 gap-2">
          <ColorField
            label="Code"
            value={selectedElement.foreground ?? '#0f172a'}
            onChange={(foreground) => onPatchElement({ foreground } as Partial<DesignElement>)}
          />
          <ColorField
            label="Backdrop"
            value={selectedElement.background ?? '#ffffff'}
            onChange={(background) => onPatchElement({ background } as Partial<DesignElement>)}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={selectedElement.x} onChange={(x) => onPatchElement({ x })} />
        <NumberField label="Y" value={selectedElement.y} onChange={(y) => onPatchElement({ y })} />
        <NumberField
          label="W"
          value={selectedElement.width}
          onChange={(width) => onPatchElement({ width })}
        />
        <NumberField
          label="H"
          value={selectedElement.height}
          onChange={(height) => onPatchElement({ height })}
        />
        <NumberField
          label="Rotate"
          value={selectedElement.rotation ?? 0}
          onChange={(rotation) => onPatchElement({ rotation })}
        />
        <NumberField
          label="Opacity"
          value={selectedElement.opacity ?? 1}
          step={0.05}
          onChange={(opacity) => onPatchElement({ opacity })}
        />
      </div>
      {'color' in selectedElement ? (
        <ColorField
          label="Text color"
          value={selectedElement.color ?? '#0f172a'}
          onChange={(color) => onPatchElement({ color } as Partial<DesignElement>)}
        />
      ) : null}
      {'fill' in selectedElement ? (
        <ColorField
          label="Fill"
          value={selectedElement.fill ?? '#ffffff'}
          onChange={(fill) => onPatchElement({ fill } as Partial<DesignElement>)}
        />
      ) : null}
      {'stroke' in selectedElement ? (
        <ColorField
          label="Stroke"
          value={selectedElement.stroke ?? '#cbd5e1'}
          onChange={(stroke) => onPatchElement({ stroke } as Partial<DesignElement>)}
        />
      ) : null}
      {'fontSize' in selectedElement ? (
        <>
          <NumberField
            label="Font size"
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
      ) : null}
      <LayerToggle
        checked={!selectedElement.locked}
        label={selectedElement.locked ? 'Locked' : 'Unlocked'}
        onChange={(unlocked) => onPatchElement({ locked: !unlocked })}
        icon={selectedElement.locked ? <Lock size={14} /> : <Unlock size={14} />}
      />
    </div>
  )
}

function PrintPanel({
  artboard,
  onPatchArtboard,
}: {
  artboard: DesignArtboard
  onPatchArtboard: (patch: Partial<DesignArtboard>) => void
}) {
  const profile = artboard.printProfile ?? {
    provider: 'browser-pdf' as PrintProvider,
    media: artboard.format === 'cr80-front' || artboard.format === 'cr80-back' ? 'cr80' : 'letter',
    duplex: artboard.format === 'cr80-front' || artboard.format === 'cr80-back',
    edgeToEdge: true,
    orientation: 'landscape' as const,
  }
  return (
    <div className="space-y-4">
      <RailLabel label="Print profile" icon={<Printer size={14} />} />
      <Field label="Provider">
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
      <Field label="Media">
        <Select
          value={profile.media}
          onChange={(e) =>
            onPatchArtboard({
              printProfile: { ...profile, media: e.currentTarget.value as any },
            })
          }
        >
          <option value="letter">Letter</option>
          <option value="cr80">CR80 card</option>
          <option value="custom">Custom</option>
        </Select>
      </Field>
      <LayerToggle
        checked={profile.duplex === true}
        label="Duplex / two-sided"
        onChange={(duplex) => onPatchArtboard({ printProfile: { ...profile, duplex } })}
      />
      <LayerToggle
        checked={profile.edgeToEdge !== false}
        label="Edge-to-edge"
        onChange={(edgeToEdge) => onPatchArtboard({ printProfile: { ...profile, edgeToEdge } })}
      />
      <div className="space-y-2">
        {PRINT_PROVIDERS.map((provider) => (
          <div
            key={provider.id}
            className={cn(
              'rounded-md border p-2 text-xs leading-5',
              provider.id === profile.provider
                ? 'border-teal-700 bg-teal-50 text-teal-900 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-200'
                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
            )}
          >
            <div className="font-semibold">{provider.label}</div>
            <div>{provider.notes}</div>
            {provider.requiresLocalBridge ? (
              <div className="mt-1 font-medium">Requires local printer bridge.</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function RailTabButton({
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
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'grid h-9 place-items-center rounded-md border text-xs',
        active
          ? 'border-teal-700 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-300'
          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      {icon}
    </button>
  )
}

function RailLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
      {icon}
      {label}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
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
      {icon}
      {label}
    </button>
  )
}

function LayerToggle({
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
        {icon}
        <span className="truncate">{label}</span>
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
      <span className="w-20 text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="h-8 w-10 rounded border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-900"
      />
      <Input value={value} onChange={(e) => onChange(e.currentTarget.value)} className="h-8" />
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
  return (
    <Field label={label}>
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

function newElement(kind: DesignElement['kind'], existing: DesignElement[]): DesignElement {
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
      field: 'recipient.fullName',
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
  let id = base
  let i = 2
  while (used.has(id)) {
    id = `${base}-${i}`
    i += 1
  }
  return id
}

function uniqueOutputName(base: string, outputs: CredentialOutput[]) {
  const used = new Set(outputs.map((output) => output.name))
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base} ${i}`)) i += 1
  return `${base} ${i}`
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

function uniqueElementId(base: string, elements: DesignElement[]) {
  const used = new Set(elements.map((element) => element.id))
  const clean = slugCredentialOutputId(base)
  let id = clean
  let i = 2
  while (used.has(id)) {
    id = `${clean}-${i}`
    i += 1
  }
  return id
}

function formatLabel(format: CredentialFormat) {
  if (format === 'wallet') return 'CR80 wallet card'
  if (format === 'letter-portrait') return 'Letter portrait'
  return 'Letter landscape'
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
