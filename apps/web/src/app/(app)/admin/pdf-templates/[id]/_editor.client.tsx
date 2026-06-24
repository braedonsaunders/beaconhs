'use client'

// PDF document editor — a full-height shell with a paper-setup bar, a Design
// tab (the GrapesJS builder at page width) and a Preview tab (Paged.js paginates
// the template with sample data into real pages + header/footer + page numbers).

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import type { Editor } from 'grapesjs'
import { ArrowLeft, FileText, Save } from 'lucide-react'
import { Button, Input, Select } from '@beaconhs/ui'
import { savePdfTemplateDesign } from '../_actions'

const PdfBuilder = dynamic(() => import('../_builder.client'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      Loading editor…
    </div>
  ),
})

const PagedPreview = dynamic(() => import('../_paged-preview.client'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      Paginating…
    </div>
  ),
})

type MergeField = { key: string; label?: string }
type Collection = { key: string; label: string; fields: { key: string; label: string }[] }
type PaperSize = 'letter' | 'a4' | 'legal'
type Orientation = 'portrait' | 'landscape'

// Page pixel dimensions @96dpi: [width, height] portrait.
const PAPER_PX: Record<PaperSize, [number, number]> = {
  letter: [816, 1056],
  a4: [794, 1123],
  legal: [816, 1344],
}
const mmToPx = (mm: number) => Math.round(mm * 3.7795)

export function pageMetrics(size: PaperSize, orientation: Orientation, marginMm: number) {
  const [pw, ph] = PAPER_PX[size]
  const [w, h] = orientation === 'landscape' ? [ph, pw] : [pw, ph]
  const m = mmToPx(marginMm)
  return { pageW: w, pageH: h, margin: m, contentW: w - 2 * m }
}

// GrapesJS keeps authored styles in getCss() (keyed by generated ids like
// #iltl), NOT inline on the elements getHtml() returns. Serializing html alone
// loses every style — so the document is the CSS block + the structure. This is
// what gets saved (sourceHtml → compiledHtml) and what the worker/Preview print.
function fullHtml(ed: Editor): string {
  const css = ed.getCss?.() ?? ''
  const html = ed.getHtml()
  return css ? `<style>${css}</style>${html}` : html
}

export function PdfTemplateEditor({
  template,
}: {
  template: {
    id: string
    name: string
    design: Record<string, unknown>
    sourceHtml?: string | null
    paperSize: PaperSize
    orientation: Orientation
    marginMm: number
    headerHtml: string
    footerHtml: string
    mergeFields: MergeField[]
    collections?: Collection[]
    subjectLabel?: string | null
  }
}) {
  const collections = template.collections ?? []
  const editorRef = useRef<Editor | null>(null)
  const [name, setName] = useState(template.name)
  const [paperSize, setPaperSize] = useState<PaperSize>(template.paperSize)
  const [orientation, setOrientation] = useState<Orientation>(template.orientation)
  const [marginMm, setMarginMm] = useState(template.marginMm)
  const [headerHtml, setHeaderHtml] = useState(template.headerHtml)
  const [footerHtml, setFooterHtml] = useState(template.footerHtml)
  const [tab, setTab] = useState<'design' | 'preview'>('design')
  const [previewHtml, setPreviewHtml] = useState('')
  const [busy, setBusy] = useState(false)

  const metrics = pageMetrics(paperSize, orientation, marginMm)

  const snapshot = () => {
    const ed = editorRef.current
    if (!ed) return null
    return {
      design: ed.getProjectData() as Record<string, unknown>,
      sourceHtml: fullHtml(ed),
    }
  }

  const onSave = async () => {
    const snap = snapshot()
    if (!snap) {
      toast.error('Editor not ready')
      return
    }
    setBusy(true)
    try {
      const res = await savePdfTemplateDesign({
        id: template.id,
        name,
        design: snap.design,
        sourceHtml: snap.sourceHtml,
        paperSize,
        orientation,
        marginMm,
        headerHtml,
        footerHtml,
      })
      if (res.ok) toast.success('Saved')
      else toast.error(res.error ?? 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const showPreview = () => {
    const ed = editorRef.current
    const html = ed ? fullHtml(ed) : (template.sourceHtml ?? '')
    setPreviewHtml(html)
    setTab('preview')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <Link
          href="/admin/pdf-templates"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Back to PDF templates"
        >
          <ArrowLeft size={18} />
        </Link>
        <FileText size={18} className="shrink-0 text-teal-600" />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-56 font-semibold"
          aria-label="Template name"
        />
        {template.subjectLabel ? (
          <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
            for <strong>{template.subjectLabel}</strong>
          </span>
        ) : null}

        {/* tabs */}
        <div className="ml-2 inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setTab('design')}
            className={`rounded px-3 py-1 text-sm ${tab === 'design' ? 'bg-teal-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
          >
            Design
          </button>
          <button
            type="button"
            onClick={showPreview}
            className={`rounded px-3 py-1 text-sm ${tab === 'preview' ? 'bg-teal-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
          >
            Preview
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Select
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as PaperSize)}
            className="h-9 w-24"
            aria-label="Paper size"
          >
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
            <option value="legal">Legal</option>
          </Select>
          <Select
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as Orientation)}
            className="h-9 w-28"
            aria-label="Orientation"
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </Select>
          <Input
            type="number"
            value={marginMm}
            min={0}
            max={50}
            onChange={(e) => setMarginMm(Number(e.target.value) || 0)}
            className="h-9 w-16"
            aria-label="Margin (mm)"
            title="Margin (mm)"
          />
          <Button onClick={onSave} disabled={busy}>
            <Save size={14} /> {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Header / footer bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900">
        <span className="shrink-0 font-medium text-slate-500 dark:text-slate-400">Header</span>
        <Input
          value={headerHtml}
          onChange={(e) => setHeaderHtml(e.target.value)}
          placeholder="e.g. {{reference}}"
          className="h-7 flex-1 text-xs"
          aria-label="Running header"
        />
        <span className="shrink-0 font-medium text-slate-500 dark:text-slate-400">Footer</span>
        <Input
          value={footerHtml}
          onChange={(e) => setFooterHtml(e.target.value)}
          placeholder="Page {{page}} of {{pages}}"
          className="h-7 flex-1 text-xs"
          aria-label="Running footer"
        />
      </div>

      {/* Body — Design or Preview */}
      <div className="min-h-0 flex-1">
        {tab === 'design' ? (
          <PdfBuilder
            initialDesign={template.design}
            initialHtml={template.sourceHtml ?? null}
            pageWidthPx={metrics.pageW}
            pageHeightPx={metrics.pageH}
            marginPx={metrics.margin}
            paperLabel={`${paperSize.toUpperCase()} · ${orientation}`}
            mergeFields={template.mergeFields}
            collections={collections}
            onReady={(ed) => {
              editorRef.current = ed
            }}
          />
        ) : (
          <PagedPreview
            templateId={template.id}
            html={previewHtml}
            mergeFields={template.mergeFields}
            collections={collections}
            paperSize={paperSize}
            orientation={orientation}
            marginMm={marginMm}
            headerHtml={headerHtml}
            footerHtml={footerHtml}
          />
        )}
      </div>
    </div>
  )
}
