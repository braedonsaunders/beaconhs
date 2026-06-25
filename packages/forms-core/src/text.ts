// Flatten rich-text HTML into readable plaintext. Many narrative columns store
// HTML (TipTap editor output, or legacy imports with `<p>`, `<strong>`,
// `&nbsp;`…) — list cells, search indexes, plain-text emails, and `<option>`
// labels need the text, not the raw markup. Pairs with `sanitizeDocumentHtml`,
// which keeps the HTML for rich rendering. Pure string ops, so it runs anywhere
// (server, worker, client) with no DOM.

const NAMED_ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, '&'],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#0?39;/g, "'"],
  [/&#0?34;/g, '"'],
  [/&apos;/gi, "'"],
]

/** Convert rich-text HTML to readable plaintext, preserving block line breaks. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  let out = html
    // Turn block-closing tags into newlines so paragraphs/list items stay split.
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/tr)\s*\/?>/gi, '$&\n')
    .replace(/<[^>]+>/g, '')
  for (const [re, ch] of NAMED_ENTITIES) out = out.replace(re, ch)
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Single-line preview: strips HTML, collapses whitespace, and ellipsizes. */
export function htmlToSnippet(html: string | null | undefined, max = 160): string {
  const clean = htmlToText(html).replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}
