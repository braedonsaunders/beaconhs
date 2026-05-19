// Document & Document-Book PDF templates.
//
// A document is rendered with a tenant letterhead wrapping the latest published
// version's content_markdown. A document book is the same with multiple
// document bodies concatenated, preceded by a cover page + table of contents.

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
  const body =
    input.version?.contentMarkdown
      ? markdownToHtml(input.version.contentMarkdown)
      : '<p class="empty">No published content for this document.</p>'

  return `
  <style>
    ${baseStyles(primary)}
    .doc-body h1 { font-size: 18pt; border-bottom: 2px solid var(--primary); padding-bottom: 4px; margin: 18px 0 10px; color: var(--primary); }
    .doc-body h2 { font-size: 14pt; margin: 14px 0 6px; color: #222; }
    .doc-body h3 { font-size: 12pt; margin: 10px 0 4px; color: #333; }
    .doc-body p { margin: 6px 0; line-height: 1.5; }
    .doc-body ul, .doc-body ol { margin: 6px 0; padding-left: 22px; }
    .doc-body li { margin: 3px 0; }
    .doc-body strong { font-weight: 700; }
    .doc-body em { font-style: italic; }
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
      const body = it.version?.contentMarkdown
        ? markdownToHtml(it.version.contentMarkdown)
        : '<p class="empty">No published content for this document.</p>'
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
    .doc-body h1 { font-size: 18pt; border-bottom: 2px solid var(--primary); padding-bottom: 4px; margin: 18px 0 10px; color: var(--primary); }
    .doc-body h2 { font-size: 14pt; margin: 14px 0 6px; color: #222; }
    .doc-body h3 { font-size: 12pt; margin: 10px 0 4px; color: #333; }
    .doc-body p { margin: 6px 0; line-height: 1.5; }
    .doc-body ul, .doc-body ol { margin: 6px 0; padding-left: 22px; }
    .doc-body li { margin: 3px 0; }
    .doc-body strong { font-weight: 700; }
    .doc-body em { font-style: italic; }
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
