// Document & Document-Book PDF templates.
//
// A document is rendered with a tenant letterhead wrapping the latest published
// version's content_markdown. A document book is the same with multiple
// document bodies concatenated, preceded by a cover page + table of contents.

import { documentBodyCss, sanitizeDocumentHtml } from '@beaconhs/forms-core'

export type DocumentRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  document: {
    key: string
    title: string
    description?: string | null
    category?: string | null
    status: string
    printHeader: boolean
    printFooter: boolean
    pageSize?: 'Letter' | 'A4' | null
    headerText?: string | null
    footerText?: string | null
    nextReviewOn?: string | Date | null
    ownerName?: string | null
  }
  version: {
    version: number
    publishedAt?: string | Date | null
    publishedBy?: string | null
    contentMarkdown?: string | null
    changelog?: string | null
  } | null
  generatedAt?: string | Date
}

export type DocumentBookRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  book: {
    title: string
    description?: string | null
    category?: string | null
    status: string
    publishedAt?: string | Date | null
  }
  items: {
    document: {
      key: string
      title: string
      category?: string | null
    }
    version: {
      version: number
      contentMarkdown?: string | null
      publishedAt?: string | Date | null
    } | null
  }[]
  generatedAt?: string | Date
}

export function renderDocumentHtml(input: DocumentRenderInput): string {
  const d = input.document
  const primary = input.primaryColor ?? '#0f766e'
  const generated = fmtDateTime(input.generatedAt ?? new Date())
  const body = bodyHtml(input.version?.contentMarkdown)

  return `
  <style>
    ${baseStyles(primary)}
    ${documentBodyCss('.doc-body')}
    ${docBodyExtraCss()}
    .doc-meta { font-size: 9pt; color: #666; margin-bottom: 14px; padding-bottom: 6px; border-bottom: 1px solid #eee; }
    .changelog { background: #fffbeb; border-left: 3px solid #b58500; padding: 8px 10px; margin: 8px 0 14px; font-size: 9.5pt; color: #5a4400; }
    .empty { color: #888; font-style: italic; }
  </style>
  ${d.printHeader ? letterhead({ tenantName: input.tenantName, tenantLogoUrl: input.tenantLogoUrl, reference: d.key, generatedAt: generated }) : ''}

  <div class="title-block">
    <h1>${esc(d.title)}</h1>
    ${d.description ? `<div class="ref">${esc(d.description)}</div>` : ''}
  </div>
  <div class="doc-meta">
    Key: <strong>${esc(d.key)}</strong>
    ${d.category ? ` · Category: ${esc(d.category)}` : ''}
    ${d.status ? ` · Status: ${esc(d.status)}` : ''}
    ${input.version ? ` · v${input.version.version}` : ''}
    ${input.version?.publishedAt ? ` · Published ${esc(fmtDate(input.version.publishedAt))}` : ''}
    ${d.ownerName ? ` · Owner: ${esc(d.ownerName)}` : ''}
    ${d.nextReviewOn ? ` · Next review: ${esc(fmtDate(d.nextReviewOn))}` : ''}
  </div>
  ${input.version?.changelog ? `<div class="changelog"><strong>Changelog:</strong> ${esc(input.version.changelog)}</div>` : ''}

  <div class="doc-body">
    ${body}
  </div>
  `
}

export function renderDocumentBookHtml(input: DocumentBookRenderInput): string {
  const b = input.book
  const primary = input.primaryColor ?? '#0f766e'
  const generated = fmtDateTime(input.generatedAt ?? new Date())

  const tocHtml = input.items
    .map(
      (it, i) =>
        `<li><span class="toc-num">${i + 1}.</span> ${esc(it.document.title)}${
          it.document.category ? ` <span class="toc-cat">— ${esc(it.document.category)}</span>` : ''
        }</li>`,
    )
    .join('')

  const bodiesHtml = input.items
    .map((it) => {
      const body = bodyHtml(it.version?.contentMarkdown)
      return `<section class="doc page-break">
        <h1>${esc(it.document.title)}</h1>
        <div class="doc-meta">
          ${it.document.category ? esc(it.document.category) + ' · ' : ''}Key: ${esc(it.document.key)}
          ${it.version ? ` · v${it.version.version}` : ''}
          ${it.version?.publishedAt ? ` · Published ${esc(fmtDate(it.version.publishedAt))}` : ''}
        </div>
        <div class="doc-body">${body}</div>
      </section>`
    })
    .join('')

  return `
  <style>
    ${baseStyles(primary)}
    .cover { padding-top: 60px; text-align: center; }
    .cover h1 { font-size: 26pt; color: var(--primary); margin: 8px 0; }
    .cover .meta { color: #475569; font-size: 10pt; }
    .toc { padding: 16px 0; }
    .toc h2 { font-size: 14pt; }
    .toc ol { list-style: none; padding: 0; margin: 0; }
    .toc li { padding: 5px 0; border-bottom: 1px dotted #cbd5e1; font-size: 11pt; }
    .toc .toc-num { display: inline-block; min-width: 30px; color: #888; }
    .toc .toc-cat { color: #888; font-size: 9.5pt; }
    ${documentBodyCss('.doc-body')}
    ${docBodyExtraCss()}
    .doc-meta { font-size: 9pt; color: #666; margin-bottom: 14px; padding-bottom: 6px; border-bottom: 1px solid #eee; }
    .empty { color: #888; font-style: italic; }
    section.doc { page-break-before: always; }
  </style>

  ${letterhead({ tenantName: input.tenantName, tenantLogoUrl: input.tenantLogoUrl, reference: b.title, generatedAt: generated })}

  <section class="cover">
    <h1>${esc(b.title)}</h1>
    ${b.description ? `<p class="meta">${esc(b.description)}</p>` : ''}
    <p class="meta">
      ${input.items.length} document${input.items.length === 1 ? '' : 's'}
      ${b.publishedAt ? ` · published ${esc(fmtDate(b.publishedAt))}` : ''}
    </p>
  </section>

  <section class="toc page-break">
    <h2>Contents</h2>
    <ol>${tocHtml}</ol>
  </section>

  ${bodiesHtml}
  `
}

// --- Helpers ---------------------------------------------------------------

function baseStyles(primary: string): string {
  return `
    :root { --primary: ${primary}; }
    * { box-sizing: border-box; }
    body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; font-size: 11pt; line-height: 1.45; margin: 0; }
    .letterhead { border-top: 8px solid var(--primary); padding: 14px 0 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #ccc; margin-bottom: 14px; }
    .letterhead .left { display: flex; align-items: center; gap: 16px; }
    .letterhead img.logo { max-height: 56px; max-width: 200px; }
    .letterhead .tenant-name { font-size: 16pt; font-weight: 700; letter-spacing: 0.5px; color: var(--primary); }
    .letterhead .right { text-align: right; font-size: 9pt; color: #444; }
    .title-block { margin: 6px 0 14px; }
    .title-block h1 { font-size: 18pt; margin: 0; color: #222; }
    .title-block .ref { font-size: 11pt; color: #555; margin-top: 4px; font-style: italic; }
    .page-break { page-break-before: always; }
  `
}

function letterhead(args: {
  tenantName: string
  tenantLogoUrl?: string | null
  reference: string
  generatedAt: string
}): string {
  return `<div class="letterhead">
    <div class="left">
      ${args.tenantLogoUrl ? `<img class="logo" src="${esc(args.tenantLogoUrl)}" alt=""/>` : ''}
      <div class="tenant-name">${esc(args.tenantName)}</div>
    </div>
    <div class="right">
      Generated ${esc(args.generatedAt)}<br/>
      ${esc(args.reference)}
    </div>
  </div>`
}

// Renders stored version content. Editor output is HTML (sanitized for the PDF);
// legacy rows may still be plain markdown, handled by the converter below.
function bodyHtml(content: string | null | undefined): string {
  if (!content) return '<p class="empty">No published content for this document.</p>'
  return /<[a-z][\s\S]*>/i.test(content) ? sanitizeDocumentHtml(content) : markdownToHtml(content)
}

// Presentation for rich HTML bodies — tables, images, marks, page breaks.
// Comment marks render invisibly and suggestion (track-change) marks render as
// their accepted state, so published PDFs show clean content.
function docBodyExtraCss(): string {
  return `
    .doc-body table { border-collapse: collapse; width: 100%; margin: 8px 0; table-layout: fixed; }
    .doc-body th, .doc-body td { border: 1px solid #cbd5e1; padding: 4px 8px; vertical-align: top; }
    .doc-body th { background: #f1f5f9; font-weight: 600; text-align: left; }
    .doc-body img { max-width: 100%; height: auto; }
    .doc-body img[data-align="center"] { display: block; margin-left: auto; margin-right: auto; }
    .doc-body img[data-align="right"] { display: block; margin-left: auto; }
    .doc-body [data-page-break] { page-break-before: always; }
    .doc-body mark { background: #fef08a; padding: 0 2px; }
    .doc-body u { text-decoration: underline; }
    .doc-body s, .doc-body del { text-decoration: line-through; }
    .doc-body sub { vertical-align: sub; font-size: 80%; }
    .doc-body sup { vertical-align: super; font-size: 80%; }
    .doc-body a { color: var(--primary); text-decoration: underline; }
    .doc-body blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding: 2px 12px; color: #475569; }
    .doc-body pre { background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 6px; overflow: auto; font-size: 9pt; }
    .doc-body code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
    .doc-body ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    .doc-body ul[data-type="taskList"] li { display: flex; gap: 6px; align-items: flex-start; }
    .doc-body .comment-mark { background: transparent; border: none; }
    .doc-body .suggestion-insert { color: inherit; text-decoration: none; }
    .doc-body .suggestion-delete { display: none; }
  `
}

// Minimal markdown → HTML converter. Supports headings (#, ##, ###), bold (**),
// italic (*), bulleted lists (- ), numbered lists (1. ), and paragraphs.
export function markdownToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inPara = false
  let inUl = false
  let inOl = false
  const closeBlocks = () => {
    if (inPara) {
      out.push('</p>')
      inPara = false
    }
    if (inUl) {
      out.push('</ul>')
      inUl = false
    }
    if (inOl) {
      out.push('</ol>')
      inOl = false
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('# ')) {
      closeBlocks()
      out.push(`<h1>${inline(line.slice(2))}</h1>`)
    } else if (line.startsWith('## ')) {
      closeBlocks()
      out.push(`<h2>${inline(line.slice(3))}</h2>`)
    } else if (line.startsWith('### ')) {
      closeBlocks()
      out.push(`<h3>${inline(line.slice(4))}</h3>`)
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (inPara) {
        out.push('</p>')
        inPara = false
      }
      if (inOl) {
        out.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        out.push('<ul>')
        inUl = true
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (inPara) {
        out.push('</p>')
        inPara = false
      }
      if (inUl) {
        out.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        out.push('<ol>')
        inOl = true
      }
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`)
    } else if (line.trim() === '') {
      closeBlocks()
    } else {
      if (inUl) {
        out.push('</ul>')
        inUl = false
      }
      if (inOl) {
        out.push('</ol>')
        inOl = false
      }
      if (!inPara) {
        out.push('<p>')
        inPara = true
      } else {
        out.push('<br/>')
      }
      out.push(inline(line))
    }
  }
  closeBlocks()
  return out.join('\n')
}

function inline(s: string): string {
  let out = esc(s)
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(?<![*])\*([^*]+?)\*(?![*])/g, '<em>$1</em>')
  return out
}

function fmtDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toISOString().slice(0, 10)
}

function fmtDateTime(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
