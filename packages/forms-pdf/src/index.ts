// Auto-PDF rendering for form responses.
//
// The renderer runs in a worker container with Chromium installed.
// We render an HTML page from the response + schema + tenant branding,
// then print-to-PDF. CSS overrides per template are applied last so admins
// can fully customise output.

import {
  entityKindForPicker,
  evaluateFormulaTree,
  evaluateLogicRule,
  sanitizeDocumentHtml,
  type EntityAttrsByField,
  type EvalContext,
  type FormSchemaV1,
  type FormulaExpression,
} from '@beaconhs/forms-core'
import {
  renderDesignDocumentHtml,
  renderDesignDocumentsHtml,
  type CredentialDesignData,
  type DesignDocument,
  type DesignDocumentData,
  type EquipmentLabelDesignData,
} from '@beaconhs/design-studio'
import {
  buildReportDocumentCss,
  buildReportPageCss,
  renderReportDocumentBodyHtml,
  resolveReportLayout,
  type ReportDocumentInput,
  type ReportLayoutConfig,
} from '@beaconhs/reports/document'
import { renderIncidentHtml, type IncidentRenderInput } from './templates/incident'
import { renderCertificateHtml, type CertificateRenderInput } from './templates/certificate'
import { renderWalletHtml, type WalletRenderInput } from './templates/wallet'
import type {
  CredentialDesignFormat,
  CredentialDesignOptions,
  CredentialDesignTemplateId,
  CredentialDesignTypeface,
} from './templates/credential-theme'
import { renderHazidHtml, type HazidRenderInput } from './templates/hazid'
import { renderCaHtml, type CaRenderInput } from './templates/ca'
import {
  renderEquipmentWorkOrderHtml,
  type EquipmentWorkOrderRenderInput,
} from './templates/equipment-workorder'
import { renderPpeIssueHtml, type PpeIssueRenderInput } from './templates/ppe-issue'
import { getBrowser as browser, closeBrowser, escapeHtml } from './util'

export type {
  IncidentRenderInput,
  CertificateRenderInput,
  WalletRenderInput,
  HazidRenderInput,
  CaRenderInput,
  EquipmentWorkOrderRenderInput,
  PpeIssueRenderInput,
  CredentialDesignFormat,
  CredentialDesignOptions,
  CredentialDesignTemplateId,
  CredentialDesignTypeface,
  CredentialDesignData,
  DesignDocument,
  DesignDocumentData,
  EquipmentLabelDesignData,
}
// Note: HazidSignedReportRenderInput is exported via the function declaration
// below so that consumers can import it alongside renderHazidSignedReportPdf.
export {
  renderIncidentHtml,
  renderCertificateHtml,
  renderWalletHtml,
  renderHazidHtml,
  renderCaHtml,
  renderEquipmentWorkOrderHtml,
  renderPpeIssueHtml,
  closeBrowser,
}

export async function renderDesignDocumentPdf(input: {
  document: DesignDocument
  data: DesignDocumentData
  title?: string
}): Promise<Buffer> {
  const html = renderDesignDocumentHtml(input.document, input.data, { title: input.title })
  return printDesignHtmlPdf(html, input.document.artboards[0])
}

/**
 * N design documents printed back-to-back as ONE multi-page PDF — one page per
 * artboard, each rendered against its own data (bulk label runs). All pages
 * print at the FIRST artboard's physical size, so callers pass a uniform run.
 */
export async function renderDesignDocumentsPdf(
  pages: { document: DesignDocument; data: DesignDocumentData }[],
  options: { title?: string } = {},
): Promise<Buffer> {
  if (pages.length === 0) throw new Error('renderDesignDocumentsPdf: no pages to render')
  const html = renderDesignDocumentsHtml(pages, { title: options.title })
  return printDesignHtmlPdf(html, pages[0]?.document.artboards[0])
}

async function printDesignHtmlPdf(
  html: string,
  first: { width: number; height: number } | undefined,
): Promise<Buffer> {
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    await page.evaluateHandle('document.fonts.ready')
    const pdf = await page.pdf({
      width: first ? `${first.width}in` : '11in',
      height: first ? `${first.height}in` : '8.5in',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

export type RenderInput = {
  schema: FormSchemaV1
  values: Record<string, unknown>
  // Picker-bound entity-attribute maps so `entity_attr` formula fields
  // resolve to the same live values they showed in the filler. Optional —
  // when omitted, those fields render as the configured `defaultDisplay`
  // (or em-dash) on the resulting PDF.
  entitiesByField?: EntityAttrsByField
  // Resolved display name per picker field id (e.g. `{ jobNumber: "Acme
  // Tower" }`) so picker fields print the entity's name instead of the raw
  // stored id. Keyed by top-level field id; repeating-row pickers are not
  // resolved and fall back to the raw id.
  pickerLabelsByField?: Record<string, string>
  metadata: {
    title: string
    reference?: string
    submittedAt?: string
    submittedBy?: string
    siteName?: string
    tenantName: string
    tenantLogoUrl?: string
    primaryColor?: string
    locale?: string
  }
  signatures?: { stepKey: string; assigneeName: string; signedAt: string; pngDataUrl?: string }[]
  customHeaderHtml?: string
  customFooterHtml?: string
  customCss?: string
  pageSize?: 'A4' | 'Letter'
}

export async function renderFormPdf(input: RenderInput): Promise<Buffer> {
  const html = buildHtml(input)
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    const pdf = await page.pdf({
      format: input.pageSize ?? 'Letter',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: input.customHeaderHtml ?? defaultHeaderHtml(input),
      footerTemplate: input.customFooterHtml ?? defaultFooterHtml(input),
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

function defaultHeaderHtml(input: RenderInput): string {
  return `<div style="font-size:9px;width:100%;padding:0 15mm;display:flex;justify-content:space-between;">
    <span>${escapeHtml(input.metadata.tenantName)}</span>
    <span>${escapeHtml(input.metadata.title)}</span>
  </div>`
}

function defaultFooterHtml(input: RenderInput): string {
  return `<div style="font-size:9px;width:100%;padding:0 15mm;display:flex;justify-content:space-between;color:#666;">
    <span>${input.metadata.reference ?? ''}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`
}

function buildHtml(input: RenderInput): string {
  const locale = input.metadata.locale ?? 'en'
  const t = (k: { [lang: string]: string } | undefined, fallback = '') =>
    k ? (k[locale] ?? k['en'] ?? Object.values(k)[0] ?? fallback) : fallback

  // Build the shared eval context for showIf + formula evaluation.
  // `input.values` carries the response payload — for repeating sections the
  // value at `values[sectionId]` is the rows array, so we hoist it into the
  // EvalContext's `rows` map at the same time.
  const rows: Record<string, Array<Record<string, unknown>>> = {}
  for (const sec of input.schema.sections) {
    if (!sec.repeating) continue
    const v = input.values[sec.id]
    rows[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
  }
  const evalCtx: EvalContext = {
    values: input.values,
    rows,
    entities: input.entitiesByField,
  }

  // Group sections by their workflow step so PDF rendering mirrors the
  // multi-step filler layout — one heading per step, then sections inside.
  const stepsList = input.schema.workflow.steps
  const defaultStepKey = stepsList[0]?.key ?? 'submit'
  const stepGroups = new Map<string, typeof input.schema.sections>()
  for (const sec of input.schema.sections) {
    const k = sec.step ?? defaultStepKey
    const list = stepGroups.get(k) ?? []
    list.push(sec)
    stepGroups.set(k, list)
  }

  const stepsHtml = stepsList
    .map((step) => {
      const stepSections = stepGroups.get(step.key) ?? []
      if (stepSections.length === 0) return ''

      const sectionsHtml = stepSections
        .map((sec) => {
          // Section-level conditional visibility — skip if showIf is false.
          if (sec.showIf && !evaluateLogicRule(sec.showIf, evalCtx)) return ''

          // Repeating sections render each row as a numbered block carrying
          // every field in the section.
          if (sec.repeating) {
            const sectionRows = rows[sec.id] ?? []
            if (sectionRows.length === 0) {
              return `<section><h2>${escapeHtml(t(sec.title))}</h2><p class="muted">(no rows)</p></section>`
            }
            const rowsHtml = sectionRows
              .map((row, i) => {
                const rowCtx: EvalContext = { ...evalCtx, values: { ...evalCtx.values, ...row } }
                const fields = sec.fields
                  .map((f) => {
                    if (f.showIf && !evaluateLogicRule(f.showIf, rowCtx)) return ''
                    const label = t(f.label)
                    let raw: unknown = row[f.id]
                    if ((f.type === 'formula' || f.type === 'calc') && f.formula) {
                      raw = evaluateFormulaTree(f.formula as FormulaExpression, rowCtx)
                    }
                    const display = renderValue(
                      f.type,
                      raw,
                      (f as { config?: Record<string, unknown> }).config,
                    )
                    if (display === null) return ''
                    return `<div class="field"><div class="lbl">${escapeHtml(label)}</div><div class="val">${display}</div></div>`
                  })
                  .filter(Boolean)
                  .join('')
                return `<div class="repeat-row"><div class="repeat-row-header">Row ${i + 1}</div>${fields}</div>`
              })
              .join('')
            return `<section><h2>${escapeHtml(t(sec.title))}</h2>${rowsHtml}</section>`
          }

          // Honor the authored column layout (section.layout.columns +
          // field.colSpan); fall back to a single stacked column otherwise.
          const cols = !sec.canvas && sec.layout && sec.layout.columns > 1 ? sec.layout.columns : 0
          // Canvas sections print in (y,x) reading order (linear — robust for
          // print; on-screen render keeps the positioned grid).
          const orderedFields = sec.canvas
            ? [...sec.fields].sort((a, b) => {
                const A = sec.canvas!.items.find((it) => it.i === a.id)
                const B = sec.canvas!.items.find((it) => it.i === b.id)
                return (A?.y ?? 0) - (B?.y ?? 0) || (A?.x ?? 0) - (B?.x ?? 0)
              })
            : sec.fields
          const fields = orderedFields
            .map((f) => {
              if (f.showIf && !evaluateLogicRule(f.showIf, evalCtx)) return ''
              const label = t(f.label)
              let raw: unknown = input.values[f.id]
              // Formula fields are recomputed on render — never stored — so
              // the PDF always shows the freshest computed value.
              if ((f.type === 'formula' || f.type === 'calc') && f.formula) {
                raw = evaluateFormulaTree(f.formula as FormulaExpression, evalCtx)
              }
              const display = renderValue(
                f.type,
                raw,
                (f as { config?: Record<string, unknown> }).config,
                input.pickerLabelsByField?.[f.id],
              )
              if (display === null) return ''
              const spanStyle = cols
                ? ` style="grid-column:span ${Math.min(f.colSpan ?? cols, cols)}"`
                : ''
              return `<div class="field"${spanStyle}><div class="lbl">${escapeHtml(label)}</div><div class="val">${display}</div></div>`
            })
            .filter(Boolean)
            .join('')

          const body = cols
            ? `<div class="field-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${fields}</div>`
            : fields
          return `<section><h2>${escapeHtml(t(sec.title))}</h2>${body}</section>`
        })
        .filter(Boolean)
        .join('')

      if (!sectionsHtml) return ''
      // A single-step form renders without the extra step heading wrapper
      // to keep PDFs visually identical to the pre-multi-step output.
      if (stepsList.length === 1) return sectionsHtml
      return `<div class="pdf-step"><h2 class="pdf-step-h">${escapeHtml(t(step.title))}</h2>${sectionsHtml}</div>`
    })
    .filter(Boolean)
    .join('')

  const sections = stepsHtml

  const sigs = (input.signatures ?? [])
    .map(
      (s) => `<div class="sig">
        <div class="sig-img">${s.pngDataUrl ? `<img src="${s.pngDataUrl}" alt="signature"/>` : '<em>(no signature image)</em>'}</div>
        <div class="sig-meta">
          <div><strong>${escapeHtml(s.stepKey)}</strong></div>
          <div>${escapeHtml(s.assigneeName)}</div>
          <div class="sig-when">${escapeHtml(s.signedAt)}</div>
        </div>
      </div>`,
    )
    .join('')

  const primary = input.metadata.primaryColor ?? '#0f766e'

  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"/>
<style>
  :root { --primary: ${primary}; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial; color: #111; font-size: 11pt; }
  header.cover { border-bottom: 3px solid var(--primary); padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; }
  header.cover h1 { font-size: 18pt; margin: 0; }
  header.cover .meta { font-size: 9.5pt; color: #444; text-align: right; }
  header.cover img.logo { max-height: 48px; }
  section { page-break-inside: avoid; margin: 16px 0; }
  section h2 { font-size: 12.5pt; color: var(--primary); margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .field { display: grid; grid-template-columns: 200px 1fr; gap: 8px; padding: 6px 0; border-bottom: 1px dotted #e5e5e5; }
  /* Multi-column section layout: stack label above value so narrow cells read well. */
  .field-grid { display: grid; column-gap: 16px; }
  .field-grid .field { grid-template-columns: 1fr; gap: 2px; }
  .field-grid .field .lbl { font-size: 9pt; text-transform: uppercase; letter-spacing: .03em; }
  .field .lbl { font-weight: 600; color: #555; }
  .field .val { color: #111; word-break: break-word; }
  .field .val img { max-width: 220px; max-height: 220px; border: 1px solid #eee; margin: 4px 4px 0 0; }
  .sig { display: flex; gap: 16px; margin: 12px 0; align-items: flex-end; border-top: 1px solid #ddd; padding-top: 10px; }
  .sig-img img { max-height: 60px; max-width: 240px; }
  .sig-meta { font-size: 9.5pt; }
  .sig-when { color: #666; }
  .muted { color: #999; font-style: italic; font-size: 10pt; }
  .repeat-row { border: 1px solid #e5e5e5; border-radius: 4px; padding: 8px 12px; margin: 6px 0; page-break-inside: avoid; }
  .repeat-row-header { font-size: 9pt; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }
  .pdf-step { margin: 22px 0 8px; }
  .pdf-step-h { font-size: 11.5pt; color: #333; background: #f1f1f1; padding: 6px 10px; border-radius: 4px; border-left: 4px solid var(--primary); margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.6px; }
  .pdf-step > section h2 { font-size: 11pt; }
  ${input.customCss ?? ''}
</style></head>
<body>
  <header class="cover">
    <div>
      ${input.metadata.tenantLogoUrl ? `<img class="logo" src="${input.metadata.tenantLogoUrl}" alt=""/>` : ''}
      <h1>${escapeHtml(input.metadata.title)}</h1>
    </div>
    <div class="meta">
      ${input.metadata.reference ? `<div><strong>${escapeHtml(input.metadata.reference)}</strong></div>` : ''}
      ${input.metadata.siteName ? `<div>${escapeHtml(input.metadata.siteName)}</div>` : ''}
      ${input.metadata.submittedAt ? `<div>${escapeHtml(input.metadata.submittedAt)}</div>` : ''}
      ${input.metadata.submittedBy ? `<div>${escapeHtml(input.metadata.submittedBy)}</div>` : ''}
    </div>
  </header>
  ${sections}
  ${sigs ? `<section><h2>Signatures</h2>${sigs}</section>` : ''}
</body></html>`
}

function renderValue(
  type: string,
  raw: unknown,
  config?: Record<string, unknown>,
  pickerLabel?: string,
): string | null {
  if (raw === undefined || raw === null || raw === '') {
    // `metric` is a live aggregate with no stored value — omit from the PDF.
    if (['heading', 'paragraph', 'image', 'divider', 'metric'].includes(type)) return null
    return '<em style="color:#999">—</em>'
  }
  // Single-entity pickers store an entity id; the caller resolves it to a
  // display name (worker-side, RLS-scoped) and passes it via
  // pickerLabelsByField. Detect them via the shared registry so new picker
  // kinds (customer/area/…) are covered without touching this switch. Fall
  // back to the raw id when no name was resolved (e.g. repeating-row pickers).
  if (entityKindForPicker(type)) {
    return escapeHtml(pickerLabel ?? String(raw))
  }
  switch (type) {
    case 'photo':
    case 'video':
    case 'audio':
    case 'file': {
      const arr = Array.isArray(raw) ? raw : [raw]
      // Each entry is an attachment ID; the caller is responsible for replacing
      // these placeholders with signed URLs before render (kept simple here).
      return arr.map((id) => `<span class="att">${escapeHtml(String(id))}</span>`).join(' ')
    }
    case 'signature':
      return '<em>see Signatures section</em>'
    case 'sketch': {
      // Freehand diagram — the value carries a PNG url (same shape as a
      // signature). Embed it inline so the lift diagram prints.
      const sk = raw as { url?: string }
      return sk && sk.url
        ? `<img src="${escapeHtml(sk.url)}" style="max-width:100%;max-height:360px;border:1px solid #ccc"/>`
        : '<em style="color:#999">—</em>'
    }
    case 'checkbox_group':
    case 'multi_select':
      return Array.isArray(raw)
        ? raw.map((x) => escapeHtml(String(x))).join(', ')
        : escapeHtml(String(raw))
    case 'yes_no_comment': {
      const v = raw as { answer?: string; comment?: string }
      return `${escapeHtml(v.answer ?? '')}${v.comment ? ` <span style="color:#666">(${escapeHtml(v.comment)})</span>` : ''}`
    }
    case 'gps': {
      const v = raw as { lat?: number; lng?: number; accuracy?: number }
      if (typeof v.lat !== 'number' || typeof v.lng !== 'number')
        return '<em style="color:#999">—</em>'
      return `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}${v.accuracy ? ` <span style="color:#666">(±${Math.round(v.accuracy)}m)</span>` : ''}`
    }
    case 'matrix': {
      const v = raw as Record<string, string>
      const cfg = (config ?? {}) as {
        rows?: { key: string; label: string }[]
        scale?: { value: string; label: string }[]
      }
      const rows = cfg.rows ?? []
      const scale = cfg.scale ?? []
      const scaleLabel = (val: string) => scale.find((s) => s.value === val)?.label ?? val
      const entries = rows.length
        ? rows.filter((r) => v[r.key]).map((r) => [r.label, v[r.key]!] as const)
        : Object.entries(v)
      if (entries.length === 0) return '<em style="color:#999">—</em>'
      return entries
        .map(
          ([label, val]) => `${escapeHtml(label)}: <strong>${escapeHtml(scaleLabel(val))}</strong>`,
        )
        .join('<br/>')
    }
    case 'lookup':
      return escapeHtml(String(raw))
    case 'data_table': {
      const ids = Array.isArray(raw) ? (raw as string[]) : []
      return ids.length
        ? `${ids.length} record${ids.length === 1 ? '' : 's'} selected`
        : '<em style="color:#999">—</em>'
    }
    case 'photo_ai': {
      const val = raw as {
        attachments?: unknown[]
        analysis?: {
          summary?: string
          overallRisk?: string
          ppe?: { item: string; status: string }[]
          hazards?: { type: string; severity: string }[]
        }
      }
      const n = val.attachments?.length ?? 0
      const a = val.analysis
      if (!a) return `${n} photo${n === 1 ? '' : 's'}`
      const parts = [
        `${n} photo${n === 1 ? '' : 's'} · risk <strong>${escapeHtml(a.overallRisk ?? '')}</strong>`,
      ]
      if (a.summary) parts.push(escapeHtml(a.summary))
      if (a.hazards?.length)
        parts.push(
          `Hazards: ${a.hazards.map((h) => escapeHtml(`${h.type} (${h.severity})`)).join(', ')}`,
        )
      const badPpe = (a.ppe ?? []).filter((p) => p.status !== 'present')
      if (badPpe.length) parts.push(`PPE: ${badPpe.map((p) => escapeHtml(p.item)).join(', ')}`)
      return parts.join('<br/>')
    }
    case 'qr_scanner':
      return escapeHtml(String(raw))
    case 'ranking': {
      const order = Array.isArray(raw) ? (raw as string[]) : []
      return order.length
        ? order.map((v, i) => `${i + 1}. ${escapeHtml(String(v))}`).join('<br/>')
        : '<em style="color:#999">—</em>'
    }
    case 'rich_text':
      return sanitizeDocumentHtml(String(raw))
    case 'address': {
      const a = raw as {
        line1?: string
        city?: string
        region?: string
        postal?: string
        country?: string
        query?: string
      }
      const lines = [
        a.line1,
        [a.city, a.region, a.postal].filter(Boolean).join(', '),
        a.country,
      ].filter(Boolean)
      return lines.length
        ? lines.map((l) => escapeHtml(String(l))).join('<br/>')
        : a.query
          ? escapeHtml(a.query)
          : '<em style="color:#999">—</em>'
    }
    case 'photo_annotated': {
      const val = raw as { attachments?: unknown[]; markers?: { label: string }[] }
      const n = val.attachments?.length ?? 0
      const markers = Array.isArray(val.markers) ? val.markers : []
      const head = `${n} photo${n === 1 ? '' : 's'}, ${markers.length} marker${markers.length === 1 ? '' : 's'}`
      return markers.length
        ? head +
            '<br/>' +
            markers.map((m, i) => `${i + 1}. ${escapeHtml(m.label || '(no note)')}`).join('<br/>')
        : escapeHtml(head)
    }
    case 'risk_matrix': {
      const v = raw as { severity?: string; likelihood?: string; score?: number; label?: string }
      return `${escapeHtml(v.severity ?? '')} × ${escapeHtml(v.likelihood ?? '')} = <strong>${escapeHtml(v.label ?? String(v.score ?? ''))}</strong>`
    }
    case 'table': {
      const cfg = (config ?? {}) as {
        columns?: {
          key: string
          label?: string
          type?: string
          options?: { value: string; label: string }[]
        }[]
        rows?: { label: string }[]
        rowMode?: string
      }
      const columns = cfg.columns ?? []
      const fixedRows = cfg.rows ?? []
      const fixed = cfg.rowMode === 'fixed'
      const stored = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
      const rows = fixed ? fixedRows.map((_, i) => stored[i] ?? {}) : stored
      if (columns.length === 0 || rows.length === 0) return '<em style="color:#999">—</em>'
      const cell = 'style="border:1px solid #ddd;padding:3px 5px;text-align:left"'
      const head =
        'style="border:1px solid #ddd;padding:3px 5px;text-align:left;background:#f8fafc"'
      const ths = `${fixed ? `<th ${head}></th>` : ''}${columns.map((c) => `<th ${head}>${escapeHtml(c.label || c.key)}</th>`).join('')}`
      const trs = rows
        .map((row, i) => {
          const lead = fixed
            ? `<td ${cell}><strong>${escapeHtml(fixedRows[i]?.label ?? `Row ${i + 1}`)}</strong></td>`
            : ''
          const tds = columns
            .map((c) => {
              const v = (row as Record<string, unknown>)[c.key]
              let s = ''
              if (v === null || v === undefined || v === '') s = ''
              else if (c.type === 'checkbox') s = v ? '✓' : ''
              else if (c.type === 'select')
                s = (c.options ?? []).find((o) => o.value === v)?.label ?? String(v)
              else s = String(v)
              return `<td ${cell}>${escapeHtml(s)}</td>`
            })
            .join('')
          return `<tr>${lead}${tds}</tr>`
        })
        .join('')
      return `<table style="border-collapse:collapse;width:100%;font-size:11px;margin-top:2px"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`
    }
    default:
      return escapeHtml(String(raw))
  }
}

// --- Incident PDF ---------------------------------------------------------

export async function renderIncidentPdf(input: IncidentRenderInput): Promise<Buffer> {
  const body = renderIncidentHtml(input)
  const html = wrapDocument(body, 'Incident Report')
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8px;width:100%;padding:0 12mm;display:flex;justify-content:space-between;color:#666;"><span>${escapeHtml(input.tenantName)}</span><span>Incident ${escapeHtml(input.incident.reference)}</span></div>`,
      footerTemplate: `<div style="font-size:8px;width:100%;padding:0 12mm;text-align:right;color:#666;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

// --- Certificate + wallet card PDF ---------------------------------------

export async function renderCertificatePdf(
  input: CertificateRenderInput & { wallet?: WalletRenderInput },
): Promise<{ certificate: Buffer; wallet: Buffer }> {
  const wallet = input.wallet ?? walletFromCertificate(input)
  const [certificate, walletPdf] = await Promise.all([
    renderCertificatePagePdf(input),
    renderWalletCardPdf(wallet),
  ])
  return { certificate, wallet: walletPdf }
}

export async function renderCertificatePagePdf(input: CertificateRenderInput): Promise<Buffer> {
  const body = renderCertificateHtml(input)
  // Certificate template carries its own @page rule + 11×8.5in landscape
  // wrapper, so we render with zero default margins and let CSS control
  // layout. The embedded @font-face data URLs must finish decoding before
  // print, hence the explicit document.fonts.ready wait.
  const html = wrapDocument(body, 'Certificate')
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    await page.evaluateHandle('document.fonts.ready')
    const portrait = input.design?.format === 'letter-portrait'
    const pdf = await page.pdf({
      width: portrait ? '8.5in' : '11in',
      height: portrait ? '11in' : '8.5in',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

export async function renderWalletCardPdf(input: WalletRenderInput): Promise<Buffer> {
  const body = renderWalletHtml(input)
  const html = wrapDocument(body, 'Wallet Card')
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    await page.evaluateHandle('document.fonts.ready')
    // CR80 credit-card size; two pages (front + back).
    const pdf = await page.pdf({
      width: '3.375in',
      height: '2.125in',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

function walletFromCertificate(input: CertificateRenderInput): WalletRenderInput {
  return {
    tenantName: input.tenantName,
    tenantLogoUrl: input.tenantLogoUrl,
    primaryColor: input.primaryColor,
    design: input.design,
    variant: input.variant,
    recipient: {
      fullName: input.recipient.fullName,
      employeeNo: input.recipient.employeeNo,
    },
    credential: input.credential,
    authorityName: input.authorityName,
    completedOn: input.completedOn,
    expiresOn: input.expiresOn,
    verifyUrl: input.verifyUrl,
    verifyToken: input.verifyToken,
    qrDataUrl: input.qrDataUrl,
    cardId: input.certificateId,
  }
}

function wrapDocument(body: string, title: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${title.replace(/[<>]/g, '')}</title></head>
<body>${body}</body></html>`
}

// --- Scheduled-report PDF -------------------------------------------------
//
// Prints the SAME document body the in-app Paged.js preview paginates, on the
// definition's configured paper (size/orientation/margins). Page numbers come
// from Puppeteer's footerTemplate — the preview's @page margin boxes are
// deliberately NOT emitted here (they would double up the footer).

export async function renderReportPdf(
  input: ReportDocumentInput & { layout?: Partial<ReportLayoutConfig> | null },
): Promise<Buffer> {
  const layout = resolveReportLayout(input.layout)
  const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>${buildReportPageCss(layout)} body { margin: 0; } ${buildReportDocumentCss(input.primaryColor, layout.density)}</style>
</head><body>${renderReportDocumentBodyHtml({
    ...input,
    summary: layout.showSummary ? input.summary : undefined,
  })}</body></html>`
  const m = `${layout.marginMm}mm`
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `<div style="font-size:8px;width:100%;padding:0 ${m};display:flex;justify-content:space-between;color:#666;">
        <span>${escapeHtml(input.tenantName)} — ${escapeHtml(input.reportName)}</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`,
      margin: { top: m, bottom: m, left: m, right: m },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

// --- Generic letterhead body renderer -------------------------------------
//
// Used by hazid / toolbox / ca / document / equipment_workorder / ppe_issue.
// Each template produces a self-contained body fragment (style + DOM) which
// we wrap in <html><head><title>...</head><body>...</body></html> and print
// on Letter-sized pages with a small footer (page n / total).

async function printLetterheadPdf(args: {
  body: string
  title: string
  footerLeft: string
  footerRight?: string
  pageSize?: 'Letter' | 'A4'
  headerHtml?: string
  showFooter?: boolean
  margin?: { top: string; bottom: string; left: string; right: string }
}): Promise<Buffer> {
  const html = wrapDocument(args.body, args.title)
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    const showFooter = args.showFooter !== false
    const pdf = await page.pdf({
      format: args.pageSize ?? 'Letter',
      printBackground: true,
      margin: args.margin ?? { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: args.headerHtml ?? `<div></div>`,
      footerTemplate: showFooter
        ? `<div style="font-size:8px;width:100%;padding:0 12mm;display:flex;justify-content:space-between;color:#666;">
        <span>${escapeHtml(args.footerLeft)}</span>
        <span>${args.footerRight ? escapeHtml(args.footerRight) + ' · ' : ''}<span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`
        : `<div></div>`,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

// --- Generic tenant PDF DOCUMENT template ---------------------------------
//
// Prints already-merged HTML (no letterhead chrome) on the chosen paper at the
// chosen orientation/margins, with the tenant's own running header/footer.
// `{{page}}`/`{{pages}}` in the header/footer become Puppeteer's live page
// counters — so the @page page numbers from the Paged.js preview match here.
export async function renderHtmlDocumentPdf(input: {
  bodyHtml: string
  paperSize: 'letter' | 'a4' | 'legal'
  orientation: 'portrait' | 'landscape'
  marginMm: number
  headerHtml?: string | null
  footerHtml?: string | null
}): Promise<Buffer> {
  const formatMap = { letter: 'Letter', a4: 'A4', legal: 'Legal' } as const
  const m = `${Math.max(0, input.marginMm)}mm`
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;} body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;}
    table{page-break-inside:auto;} tr{page-break-inside:avoid;}
  </style></head><body>${input.bodyHtml}</body></html>`
  const pageCounters = (s?: string | null): string =>
    s
      ? s
          .replace(/\{\{\s*page\s*\}\}/g, '<span class="pageNumber"></span>')
          .replace(/\{\{\s*pages\s*\}\}/g, '<span class="totalPages"></span>')
      : ''
  const headerTemplate = input.headerHtml
    ? `<div style="font-size:8px;width:100%;padding:0 ${m};color:#64748b;">${pageCounters(input.headerHtml)}</div>`
    : `<div></div>`
  const footerTemplate = input.footerHtml
    ? `<div style="font-size:8px;width:100%;padding:0 ${m};color:#94a3b8;text-align:center;">${pageCounters(input.footerHtml)}</div>`
    : `<div></div>`
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    const pdf = await page.pdf({
      format: formatMap[input.paperSize] ?? 'Letter',
      landscape: input.orientation === 'landscape',
      printBackground: true,
      margin: { top: m, bottom: m, left: m, right: m },
      displayHeaderFooter: Boolean(input.headerHtml || input.footerHtml),
      headerTemplate,
      footerTemplate,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

// --- HazID assessment PDF -------------------------------------------------

export async function renderHazidPdf(input: HazidRenderInput): Promise<Buffer> {
  return printLetterheadPdf({
    body: renderHazidHtml(input),
    title: 'Hazard Assessment',
    footerLeft: input.tenantName,
    footerRight: `Hazard Assessment ${input.assessment.reference}`,
  })
}

// --- HazID signed-report bundle PDF ---------------------------------------
//
// Bundles N assessments into a single PDF: a cover page followed by each
// assessment rendered via renderHazidHtml(), separated by hard page breaks.
// The whole document is sent to puppeteer once so signatures + photos all
// land in a single artifact suitable for distribution.

export type HazidSignedReportRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  report: {
    title: string
    description?: string | null
    builtAt: string | Date
    builtByName?: string | null
    assessmentCount: number
  }
  // The same shape as a per-assessment HazidRenderInput, sans the redundant
  // tenant/letterhead block. We re-use renderHazidHtml() so output matches
  // the standalone /hazard-assessments/[id]/pdf rendering exactly.
  assessments: HazidRenderInput[]
  generatedAt?: string | Date
}

export async function renderHazidSignedReportPdf(
  input: HazidSignedReportRenderInput,
): Promise<Buffer> {
  const cover = renderHazidSignedReportCover(input)
  const body = input.assessments
    .map((a, i) => {
      // Every assessment past the first starts on a fresh page. We rely on
      // the explicit page-break-after wrapper to keep puppeteer from running
      // pages together when an assessment is short.
      const sep =
        i === 0 ? '' : '<div style="page-break-after: always; height: 0; overflow: hidden;"></div>'
      return `${sep}<div class="bundled-assessment">${renderHazidHtml(a)}</div>`
    })
    .join('\n')

  // The bundled PDF is one big self-contained HTML document. We don't reuse
  // printLetterheadPdf() because the cover page owns its own letterhead and
  // the per-assessment renderer already emits a letterhead inside its body.
  const html = wrapDocument(
    `${cover}<div style="page-break-after: always; height: 0; overflow: hidden;"></div>${body}`,
    input.report.title || 'Signed Report Bundle',
  )

  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 })
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `<div style="font-size:8px;width:100%;padding:0 12mm;display:flex;justify-content:space-between;color:#666;">
        <span>${escapeHtml(input.tenantName)} · ${escapeHtml(input.report.title)}</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

function renderHazidSignedReportCover(input: HazidSignedReportRenderInput): string {
  const primary = input.primaryColor ?? '#1f3a5f'
  const builtAt = formatBundleDateTime(input.report.builtAt)
  const generated = formatBundleDateTime(input.generatedAt ?? new Date())

  const items =
    input.assessments.length === 0
      ? '<li class="muted">No assessments selected.</li>'
      : input.assessments
          .map((a, i) => {
            const refDate = formatBundleDateTime(a.assessment.occurredAt)
            return `<li>
              <div class="row-num">${i + 1}.</div>
              <div class="row-body">
                <div class="row-ref">${escapeHtml(a.assessment.reference)}</div>
                <div class="row-meta">
                  ${a.assessment.typeName ? escapeHtml(a.assessment.typeName) + ' · ' : ''}
                  ${a.assessment.siteName ? escapeHtml(a.assessment.siteName) + ' · ' : ''}
                  ${escapeHtml(refDate)}
                </div>
                ${
                  a.assessment.supervisorName
                    ? `<div class="row-sub">Supervisor: ${escapeHtml(a.assessment.supervisorName)}</div>`
                    : ''
                }
              </div>
            </li>`
          })
          .join('')

  return `<section class="bundle-cover">
    <style>
      .bundle-cover { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; font-size: 11pt; line-height: 1.5; padding: 0 0 16px; }
      .bundle-cover .header { border-top: 8px solid ${primary}; padding: 16px 0 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #ccc; margin-bottom: 18px; }
      .bundle-cover .header .left { display: flex; align-items: center; gap: 16px; }
      .bundle-cover .header img.logo { max-height: 56px; max-width: 220px; }
      .bundle-cover .header .tenant-name { font-size: 16pt; font-weight: 700; letter-spacing: 0.5px; color: ${primary}; }
      .bundle-cover .header .right { text-align: right; font-size: 9pt; color: #444; }
      .bundle-cover h1 { font-size: 20pt; margin: 18px 0 4px; color: #222; text-transform: uppercase; letter-spacing: 1.5px; text-align: center; }
      .bundle-cover .subtitle { text-align: center; color: #555; font-style: italic; margin-bottom: 18px; }
      .bundle-cover .meta-block { width: 100%; border-collapse: collapse; margin: 12px auto 18px; max-width: 540px; }
      .bundle-cover .meta-block td { padding: 5px 8px; font-size: 10pt; vertical-align: top; }
      .bundle-cover .meta-block td.lbl { color: #555; font-weight: 600; width: 40%; }
      .bundle-cover .description { background: #f8f8f8; border-left: 4px solid ${primary}; padding: 10px 14px; margin: 18px 0; font-size: 10.5pt; }
      .bundle-cover h2.included { font-size: 12pt; color: ${primary}; border-bottom: 1px solid ${primary}; padding-bottom: 4px; margin: 22px 0 12px; text-transform: uppercase; letter-spacing: 1px; }
      .bundle-cover ol.assessment-list { list-style: none; padding: 0; margin: 0; }
      .bundle-cover ol.assessment-list > li { display: flex; gap: 10px; padding: 8px 4px; border-bottom: 1px dotted #ddd; page-break-inside: avoid; }
      .bundle-cover .row-num { width: 28px; font-weight: 700; color: ${primary}; }
      .bundle-cover .row-body { flex: 1; }
      .bundle-cover .row-ref { font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10pt; }
      .bundle-cover .row-meta { font-size: 9.5pt; color: #555; margin-top: 2px; }
      .bundle-cover .row-sub { font-size: 9pt; color: #666; margin-top: 1px; font-style: italic; }
      .bundle-cover .muted { color: #888; font-style: italic; }
      .bundle-cover .footer-note { margin-top: 28px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 9pt; color: #777; text-align: center; font-style: italic; }
    </style>
    <div class="header">
      <div class="left">
        ${input.tenantLogoUrl ? `<img class="logo" src="${escapeHtml(input.tenantLogoUrl)}" alt=""/>` : ''}
        <div class="tenant-name">${escapeHtml(input.tenantName)}</div>
      </div>
      <div class="right">
        Generated ${escapeHtml(generated)}
      </div>
    </div>
    <h1>${escapeHtml(input.report.title)}</h1>
    <div class="subtitle">Signed-Report Bundle · ${input.report.assessmentCount} assessment${input.report.assessmentCount === 1 ? '' : 's'}</div>
    <table class="meta-block">
      <tr>
        <td class="lbl">Bundle title</td>
        <td>${escapeHtml(input.report.title)}</td>
      </tr>
      <tr>
        <td class="lbl">Built by</td>
        <td>${escapeHtml(input.report.builtByName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Built at</td>
        <td>${escapeHtml(builtAt)}</td>
      </tr>
      <tr>
        <td class="lbl">Assessments included</td>
        <td>${input.report.assessmentCount}</td>
      </tr>
    </table>
    ${
      input.report.description
        ? `<div class="description">${escapeHtml(input.report.description)}</div>`
        : ''
    }
    <h2 class="included">Included Assessments</h2>
    <ol class="assessment-list">
      ${items}
    </ol>
    <div class="footer-note">
      Each assessment that follows is reproduced in full, including all sub-forms (WAH / Confined Space / Arc Flash), signatures, and photos.
    </div>
  </section>`
}

function formatBundleDateTime(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

// --- Corrective Action PDF ------------------------------------------------

export async function renderCaPdf(input: CaRenderInput): Promise<Buffer> {
  return printLetterheadPdf({
    body: renderCaHtml(input),
    title: 'Corrective Action',
    footerLeft: input.tenantName,
    footerRight: `CA ${input.ca.reference}`,
  })
}

// --- Equipment Work Order PDF ---------------------------------------------

export async function renderEquipmentWorkOrderPdf(
  input: EquipmentWorkOrderRenderInput,
): Promise<Buffer> {
  return printLetterheadPdf({
    body: renderEquipmentWorkOrderHtml(input),
    title: 'Equipment Work Order',
    footerLeft: input.tenantName,
    footerRight: `WO ${input.workOrder.reference}`,
  })
}

// --- PPE Issue Report PDF -------------------------------------------------

export async function renderPpeIssuePdf(input: PpeIssueRenderInput): Promise<Buffer> {
  return printLetterheadPdf({
    body: renderPpeIssueHtml(input),
    title: 'PPE Issue Report',
    footerLeft: input.tenantName,
    footerRight: `PPE Issue`,
  })
}

// --- Generic record summary PDF -------------------------------------------
// A branded key-value table built from a flow's field-map. Used to attach a PDF
// for modules that have no bespoke renderer (journals, inspections).

export type RecordSummaryRenderInput = {
  tenantName: string
  heading: string
  reference?: string | null
  subtitle?: string | null
  fields: { label: string; value: string }[]
}

export async function renderRecordSummaryPdf(input: RecordSummaryRenderInput): Promise<Buffer> {
  return printLetterheadPdf({
    body: renderRecordSummaryHtml(input),
    title: input.heading,
    footerLeft: input.tenantName,
    footerRight: input.reference ?? undefined,
  })
}

function renderRecordSummaryHtml(input: RecordSummaryRenderInput): string {
  const rows =
    input.fields.length === 0
      ? `<tr><td style="padding:8px 10px;border:1px solid #e2e8f0;color:#94a3b8;">No details captured.</td></tr>`
      : input.fields
          .map(
            (f) => `<tr>
              <th style="text-align:left;padding:7px 10px;background:#f1f5f9;border:1px solid #e2e8f0;width:34%;font-weight:600;vertical-align:top;color:#334155;">${escapeHtml(
                f.label,
              )}</th>
              <td style="padding:7px 10px;border:1px solid #e2e8f0;vertical-align:top;white-space:pre-wrap;color:#0f172a;">${escapeHtml(
                f.value,
              )}</td>
            </tr>`,
          )
          .join('')
  return `
    <h1 style="font-size:19px;margin:0 0 4px;color:#0f172a;">${escapeHtml(input.heading)}</h1>
    ${input.subtitle ? `<p style="margin:0 0 2px;font-size:13px;color:#475569;">${escapeHtml(input.subtitle)}</p>` : ''}
    ${
      input.reference
        ? `<p style="margin:0 0 16px;font-size:12px;color:#64748b;">Reference: ${escapeHtml(input.reference)}</p>`
        : '<div style="height:10px"></div>'
    }
    <table style="width:100%;border-collapse:collapse;font-size:12px;">${rows}</table>
  `
}
