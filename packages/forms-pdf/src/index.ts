// Auto-PDF rendering for form responses.
//
// The renderer runs in a worker container with Chromium installed.
// We render an HTML page from the response + schema + tenant branding,
// then print-to-PDF. CSS overrides per template are applied last so admins
// can fully customise output.

import {
  evaluateFormulaTree,
  evaluateLogicRule,
  type EvalContext,
  type FormSchemaV1,
  type FormulaExpression,
} from '@beaconhs/forms-core'
import { renderIncidentHtml, type IncidentRenderInput } from './templates/incident'
import { renderCertificateHtml, type CertificateRenderInput } from './templates/certificate'
import { renderWalletHtml, type WalletRenderInput } from './templates/wallet'
import { renderReportHtml, type ReportRenderInput, type ReportGroup } from './templates/report'
import { renderHazidHtml, type HazidRenderInput } from './templates/hazid'
import { renderToolboxHtml, type ToolboxRenderInput } from './templates/toolbox'
import { renderCaHtml, type CaRenderInput } from './templates/ca'
import {
  renderDocumentHtml,
  renderDocumentBookHtml,
  type DocumentRenderInput,
  type DocumentBookRenderInput,
} from './templates/document'
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
  ReportRenderInput,
  ReportGroup,
  HazidRenderInput,
  ToolboxRenderInput,
  CaRenderInput,
  DocumentRenderInput,
  DocumentBookRenderInput,
  EquipmentWorkOrderRenderInput,
  PpeIssueRenderInput,
}
// Note: HazidSignedReportRenderInput is exported via the function declaration
// below so that consumers can import it alongside renderHazidSignedReportPdf.
export {
  renderIncidentHtml,
  renderCertificateHtml,
  renderWalletHtml,
  renderReportHtml,
  renderHazidHtml,
  renderToolboxHtml,
  renderCaHtml,
  renderDocumentHtml,
  renderDocumentBookHtml,
  renderEquipmentWorkOrderHtml,
  renderPpeIssueHtml,
  closeBrowser,
}

export type RenderInput = {
  schema: FormSchemaV1
  values: Record<string, unknown>
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
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })
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
    k ? k[locale] ?? k['en'] ?? Object.values(k)[0] ?? fallback : fallback

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
                    const display = renderValue(f.type, raw)
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

          const fields = sec.fields
            .map((f) => {
              if (f.showIf && !evaluateLogicRule(f.showIf, evalCtx)) return ''
              const label = t(f.label)
              let raw: unknown = input.values[f.id]
              // Formula fields are recomputed on render — never stored — so
              // the PDF always shows the freshest computed value.
              if ((f.type === 'formula' || f.type === 'calc') && f.formula) {
                raw = evaluateFormulaTree(f.formula as FormulaExpression, evalCtx)
              }
              const display = renderValue(f.type, raw)
              if (display === null) return ''
              return `<div class="field"><div class="lbl">${escapeHtml(label)}</div><div class="val">${display}</div></div>`
            })
            .filter(Boolean)
            .join('')

          return `<section><h2>${escapeHtml(t(sec.title))}</h2>${fields}</section>`
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

function renderValue(type: string, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') {
    if (['heading', 'paragraph', 'image', 'divider'].includes(type)) return null
    return '<em style="color:#999">—</em>'
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
    case 'checkbox_group':
    case 'multi_select':
      return Array.isArray(raw) ? raw.map((x) => escapeHtml(String(x))).join(', ') : escapeHtml(String(raw))
    case 'yes_no_comment': {
      const v = raw as { answer?: string; comment?: string }
      return `${escapeHtml(v.answer ?? '')}${v.comment ? ` <span style="color:#666">(${escapeHtml(v.comment)})</span>` : ''}`
    }
    case 'risk_matrix': {
      const v = raw as { severity?: string; likelihood?: string; score?: number; label?: string }
      return `${escapeHtml(v.severity ?? '')} × ${escapeHtml(v.likelihood ?? '')} = <strong>${escapeHtml(v.label ?? String(v.score ?? ''))}</strong>`
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
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })
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
    renderCertificateOnly(input),
    renderWalletOnly(wallet),
  ])
  return { certificate, wallet: walletPdf }
}

async function renderCertificateOnly(input: CertificateRenderInput): Promise<Buffer> {
  const body = renderCertificateHtml(input)
  // Certificate template carries its own @page rule + outer 8.5×11 wrapper,
  // so we render with zero default margins and let CSS control layout.
  const html = wrapDocument(body, 'Certificate of Completion')
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

async function renderWalletOnly(input: WalletRenderInput): Promise<Buffer> {
  const body = renderWalletHtml(input)
  const html = wrapDocument(body, 'Wallet Card')
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })
    const pdf = await page.pdf({
      width: '3.5in',
      height: '2in',
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
    recipient: {
      fullName: input.recipient.fullName,
      employeeNo: input.recipient.employeeNo,
    },
    course: input.course,
    completedOn: input.completedOn,
    expiresOn: input.expiresOn,
    verifyUrl: input.verifyUrl,
    verifyToken: input.verifyToken,
    qrDataUrl: input.qrDataUrl,
  }
}

function wrapDocument(body: string, title: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${title.replace(/[<>]/g, '')}</title></head>
<body>${body}</body></html>`
}

// --- Scheduled-report PDF -------------------------------------------------

export async function renderReportPdf(input: ReportRenderInput): Promise<Buffer> {
  // The report template owns its own <html>+<head> (with @page size) so we
  // pass it through to the page directly.
  const html = renderReportHtml(input)
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `<div style="font-size:8px;width:100%;padding:0 12mm;display:flex;justify-content:space-between;color:#666;">
        <span>${escapeHtml(input.tenantName)} — ${escapeHtml(input.reportName)}</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`,
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
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
}): Promise<Buffer> {
  const html = wrapDocument(args.body, args.title)
  const b = await browser()
  const page = await b.newPage()
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `<div style="font-size:8px;width:100%;padding:0 12mm;display:flex;justify-content:space-between;color:#666;">
        <span>${escapeHtml(args.footerLeft)}</span>
        <span>${args.footerRight ? escapeHtml(args.footerRight) + ' · ' : ''}<span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`,
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
    footerRight: `HazID ${input.assessment.reference}`,
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
  // the standalone /hazid/[id]/pdf rendering exactly.
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
        i === 0
          ? ''
          : '<div style="page-break-after: always; height: 0; overflow: hidden;"></div>'
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
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60_000 })
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

// --- Toolbox Journal PDF --------------------------------------------------

export async function renderToolboxPdf(input: ToolboxRenderInput): Promise<Buffer> {
  return printLetterheadPdf({
    body: renderToolboxHtml(input),
    title: 'Toolbox Talk',
    footerLeft: input.tenantName,
    footerRight: `Toolbox ${input.journal.reference}`,
  })
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

// --- Document PDF ---------------------------------------------------------

export async function renderDocumentPdf(input: DocumentRenderInput): Promise<Buffer> {
  return printLetterheadPdf({
    body: renderDocumentHtml(input),
    title: input.document.title,
    footerLeft: input.tenantName,
    footerRight: input.document.key,
  })
}

// --- Document Book PDF ----------------------------------------------------

export async function renderDocumentBookPdf(input: DocumentBookRenderInput): Promise<Buffer> {
  return printLetterheadPdf({
    body: renderDocumentBookHtml(input),
    title: input.book.title,
    footerLeft: input.tenantName,
    footerRight: input.book.title,
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
