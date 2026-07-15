// Flatten rich-text HTML into readable plaintext. Many narrative columns store
// HTML (TipTap editor output or imported office content), while list cells,
// search indexes, plain-text emails, and option labels need text. Parse through
// the same hardened DOM implementation used by the canonical rich-text
// sanitizer; regex tag stripping is not an HTML parser and can expose content
// hidden in malformed or nested markup.

import DOMPurify from 'isomorphic-dompurify'

type TextTreeNode = {
  childNodes?: ArrayLike<TextTreeNode>
  nodeName?: string
  nodeType: number
  textContent?: string | null
}

const TEXT_NODE = 3
const BLOCK_ELEMENTS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
])

function appendText(node: TextTreeNode, out: string[]): void {
  if (node.nodeType === TEXT_NODE) {
    out.push(node.textContent ?? '')
    return
  }
  const name = node.nodeName?.toUpperCase()
  if (name === 'BR') out.push('\n')
  for (const child of Array.from(node.childNodes ?? [])) appendText(child, out)
  if (name && BLOCK_ELEMENTS.has(name)) out.push('\n')
}

/** Convert rich-text HTML to readable plaintext, preserving block line breaks. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  const root = DOMPurify.sanitize(html, {
    ALLOWED_ATTR: [],
    RETURN_DOM: true,
  }) as unknown as TextTreeNode
  const out: string[] = []
  appendText(root, out)
  return out
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Single-line preview: strips HTML, collapses whitespace, and ellipsizes. */
export function htmlToSnippet(html: string | null | undefined, max = 160): string {
  const clean = htmlToText(html).replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}
