'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// PDF document editor — a full-height shell with a paper-setup bar and three
// tabs: Design (the GrapesJS builder at page width), HTML (the same markup as
// raw text, for power users) and Preview (Paged.js paginates the template with
// sample data into real pages + header/footer + page numbers).
//
// All three read and write ONE markup string, so an edit made in either editor
// is what gets saved and what the preview paginates.

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { Editor } from 'grapesjs'
import { ArrowLeft, Copy, FileText, Save } from 'lucide-react'
import { Button, Input, Select, Textarea } from '@beaconhs/ui'
import { savePdfTemplateAsCopy, savePdfTemplateDesign } from '../_actions'
import { serializeTemplateEditor } from '@/lib/template-builder-html'

const PdfBuilder = dynamic(() => import('../_builder.client'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      <GeneratedText id="m_0743b8515ca318" />
    </div>
  ),
})

const PagedPreview = dynamic(() => import('../_paged-preview.client'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      <GeneratedText id="m_0d7c240956c1d3" />
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

function pageMetrics(size: PaperSize, orientation: Orientation, marginMm: number) {
  const [pw, ph] = PAPER_PX[size]
  const [w, h] = orientation === 'landscape' ? [ph, pw] : [pw, ph]
  const m = mmToPx(marginMm)
  return { pageW: w, pageH: h, margin: m, contentW: w - 2 * m }
}

export function PdfTemplateEditor({
  template,
}: {
  template: {
    id: string
    name: string
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const collections = template.collections ?? []
  const editorRef = useRef<Editor | null>(null)
  const [name, setName] = useState(template.name)
  const [paperSize, setPaperSize] = useState<PaperSize>(template.paperSize)
  const [orientation, setOrientation] = useState<Orientation>(template.orientation)
  const [marginMm, setMarginMm] = useState(template.marginMm)
  const [headerHtml, setHeaderHtml] = useState(template.headerHtml)
  const [footerHtml, setFooterHtml] = useState(template.footerHtml)
  const [tab, setTab] = useState<'design' | 'html' | 'preview'>('design')
  const [previewHtml, setPreviewHtml] = useState('')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  // The authoritative markup between tab switches. The designer owns it while
  // the Design tab is open; the HTML tab edits this string directly and the
  // canvas is remounted from it (keyed) when you switch back.
  const [sourceDraft, setSourceDraft] = useState(template.sourceHtml ?? '')
  const [builderKey, setBuilderKey] = useState(0)

  const metrics = pageMetrics(paperSize, orientation, marginMm)

  /** Current markup: live from the canvas on Design, else the raw draft. */
  const currentHtml = (): string | null => {
    if (tab !== 'design') return sourceDraft
    const ed = editorRef.current
    return ed ? serializeTemplateEditor(ed) : null
  }

  const goToTab = (next: 'design' | 'html' | 'preview') => {
    const html = currentHtml()
    if (html !== null) setSourceDraft(html)
    if (next === 'design' && tab === 'html') setBuilderKey((k) => k + 1)
    if (next === 'preview') setPreviewHtml(html ?? template.sourceHtml ?? '')
    setTab(next)
  }

  const onSave = async () => {
    const sourceHtml = currentHtml()
    if (sourceHtml === null) {
      toast.error(tGenerated('m_004a5b87102f57'))
      return
    }
    setSourceDraft(sourceHtml)
    setBusy(true)
    try {
      const res = await savePdfTemplateDesign({
        id: template.id,
        name,
        sourceHtml,
        paperSize,
        orientation,
        marginMm,
        headerHtml,
        footerHtml,
      })
      if (res.ok) toast.success(tGenerated('m_0a0569b726b225'))
      else toast.error(tGeneratedValue(res.error ?? tGenerated('m_0731204fbd1b17')))
    } catch {
      toast.error(tGenerated('m_0731204fbd1b17'))
    } finally {
      setBusy(false)
    }
  }

  const onSaveAsCopy = async () => {
    const sourceHtml = currentHtml()
    if (sourceHtml === null) {
      toast.error(tGenerated('m_004a5b87102f57'))
      return
    }
    setBusy(true)
    try {
      const res = await savePdfTemplateAsCopy({
        id: template.id,
        name: `${name} (copy)`,
        sourceHtml,
        paperSize,
        orientation,
        marginMm,
        headerHtml,
        footerHtml,
      })
      if (res.ok && res.id) {
        toast.success(tGeneratedValue('Saved as a copy.'))
        router.push(`/admin/pdf-templates/${res.id}`)
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0731204fbd1b17')))
      }
    } catch {
      toast.error(tGenerated('m_0731204fbd1b17'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <Link
          href="/admin/pdf-templates"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label={tGenerated('m_13899c0860b860')}
        >
          <ArrowLeft size={18} />
        </Link>
        <FileText size={18} className="shrink-0 text-teal-600" />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          className="h-9 w-56 font-semibold"
          aria-label={tGenerated('m_1042308a24d5eb')}
        />
        <GeneratedValue
          value={
            template.subjectLabel ? (
              <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
                <GeneratedText id="m_0c496181655d02" />{' '}
                <strong>
                  <GeneratedValue value={template.subjectLabel} />
                </strong>
              </span>
            ) : null
          }
        />

        {/* tabs */}
        <div className="ml-2 inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
          <button
            type="button"
            onClick={() => goToTab('design')}
            className={`rounded px-3 py-1 text-sm ${tab === 'design' ? 'bg-teal-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
          >
            <GeneratedText id="m_0006b9b63f781f" />
          </button>
          <button
            type="button"
            onClick={() => goToTab('html')}
            className={`rounded px-3 py-1 text-sm ${tab === 'html' ? 'bg-teal-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
          >
            <GeneratedText id="m_02c198fd90b44e" />
          </button>
          <button
            type="button"
            onClick={() => goToTab('preview')}
            className={`rounded px-3 py-1 text-sm ${tab === 'preview' ? 'bg-teal-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
          >
            <GeneratedText id="m_11d37007232de5" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Select
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as PaperSize)}
            className="h-9 w-24"
            aria-label={tGenerated('m_185f497c899c62')}
          >
            <option value="letter">{'Letter'}</option>
            <option value="a4">{'A4'}</option>
            <option value="legal">{'Legal'}</option>
          </Select>
          <Select
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as Orientation)}
            className="h-9 w-28"
            aria-label={tGenerated('m_0af3bf11ca2a12')}
          >
            <option value="portrait">{'Portrait'}</option>
            <option value="landscape">{'Landscape'}</option>
          </Select>
          <Input
            type="number"
            value={marginMm}
            min={0}
            max={50}
            onChange={(e) => setMarginMm(Number(e.target.value) || 0)}
            className="h-9 w-16"
            aria-label={tGenerated('m_1c6c76aa5568a9')}
            title={tGenerated('m_1c6c76aa5568a9')}
          />
          <Button variant="outline" onClick={onSaveAsCopy} disabled={busy}>
            <Copy size={14} /> <GeneratedValue value="Save as copy" />
          </Button>
          <Button onClick={onSave} disabled={busy}>
            <Save size={14} />{' '}
            <GeneratedValue
              value={
                busy ? (
                  <GeneratedText id="m_106811f2aac664" />
                ) : (
                  <GeneratedText id="m_19e6bff894c3c7" />
                )
              }
            />
          </Button>
        </div>
      </div>

      {/* Header / footer bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900">
        <span className="shrink-0 font-medium text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_05553037a5dd7a" />
        </span>
        <Input
          value={headerHtml}
          onChange={(e) => setHeaderHtml(e.target.value)}
          placeholder={tGenerated('m_0d745d825adcaf')}
          className="h-7 flex-1 text-xs"
          aria-label={tGenerated('m_10b31f30f70f1d')}
        />
        <span className="shrink-0 font-medium text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_1781699b936a8e" />
        </span>
        <Input
          value={footerHtml}
          onChange={(e) => setFooterHtml(e.target.value)}
          placeholder={tGenerated('m_170607f1b25ae4')}
          className="h-7 flex-1 text-xs"
          aria-label={tGenerated('m_16e1c14feaef14')}
        />
      </div>

      {/* Body — Design or Preview */}
      <div className="min-h-0 flex-1">
        <GeneratedValue
          value={
            tab === 'html' ? (
              <div className="flex h-full min-h-0 flex-col gap-1.5 p-3">
                <p className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_13f8bb86805041" />
                </p>
                <Textarea
                  value={sourceDraft}
                  onChange={(e) => setSourceDraft(e.target.value)}
                  spellCheck={false}
                  aria-label={tGenerated('m_12a44c42d2c6f4')}
                  className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
                />
              </div>
            ) : tab === 'design' ? (
              <PdfBuilder
                key={builderKey}
                initialHtml={sourceDraft || null}
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
            )
          }
        />
      </div>
    </div>
  )
}
