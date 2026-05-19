// Auto-PDF rendering for form responses.
//
// The renderer runs in a worker container with Chromium installed.
// We render an HTML page from the response + schema + tenant branding,
// then print-to-PDF. CSS overrides per template are applied last so admins
// can fully customise output.

import puppeteer, { type Browser } from 'puppeteer-core'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { renderIncidentHtml, type IncidentRenderInput } from './templates/incident'
import { renderCertificateHtml, type CertificateRenderInput } from './templates/certificate'
import { renderWalletHtml, type WalletRenderInput } from './templates/wallet'

export type { IncidentRenderInput, CertificateRenderInput, WalletRenderInput }
export { renderIncidentHtml, renderCertificateHtml, renderWalletHtml }

let browserPromise: Promise<Browser> | null = null
function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
      ],
    })
  }
  return browserPromise
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

  const sections = input.schema.sections
    .map((sec) => {
      const fields = sec.fields
        .map((f) => {
          const label = t(f.label)
          const raw = input.values[f.id]
          const display = renderValue(f.type, raw)
          if (display === null) return ''
          return `<div class="field"><div class="lbl">${escapeHtml(label)}</div><div class="val">${display}</div></div>`
        })
        .filter(Boolean)
        .join('')
      return `<section><h2>${escapeHtml(t(sec.title))}</h2>${fields}</section>`
    })
    .join('')

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
