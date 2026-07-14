// Server-side sanitizer for rich-text document HTML (TipTap editor output and
// document-tooling HTML). Lives in forms-core so the web app, the PDF worker,
// and the email composer can all share one allow-list. Runs in Node via jsdom.
//
// Rich documents use an explicit static-content allow-list. Resource-loading,
// interactive, embedded, and legacy presentation elements are deliberately
// excluded: stored HTML must not submit forms, execute a same-origin gadget, or
// turn a document view into a tracking surface.

import DOMPurify from 'isomorphic-dompurify'

const SAFE_TEXT_ALIGN = new Set(['left', 'right', 'center', 'justify', 'start', 'end'])
const SAFE_FONT_STYLE = new Set(['normal', 'italic', 'oblique'])
const SAFE_TEXT_TRANSFORM = new Set(['none', 'capitalize', 'uppercase', 'lowercase'])
const SAFE_VERTICAL_ALIGN = new Set([
  'baseline',
  'sub',
  'super',
  'text-top',
  'text-bottom',
  'middle',
  'top',
  'bottom',
])
const SAFE_TEXT_DECORATION_TOKENS = new Set([
  'none',
  'underline',
  'overline',
  'line-through',
  'solid',
  'double',
  'dotted',
  'dashed',
  'wavy',
])
const TABLE_SIZE_TAGS = new Set(['TABLE', 'COL', 'TH', 'TD'])
const SAFE_DOCUMENT_TAGS = [
  'p',
  'br',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'del',
  'mark',
  'small',
  'sub',
  'sup',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'ul',
  'ol',
  'li',
  'a',
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'hr',
  'abbr',
  'cite',
  'q',
  'kbd',
  'samp',
  'var',
] as const
const SAFE_DOCUMENT_ATTRIBUTES = [
  'href',
  'target',
  'rel',
  'title',
  'style',
  'class',
  'colspan',
  'rowspan',
  'scope',
  'colwidth',
  'start',
  'reversed',
  'data-type',
  'data-checked',
  'data-color',
  'data-comment-id',
  'data-suggestion',
] as const
const SAFE_RICH_TEXT_CLASSES = new Set([
  'text-teal-700',
  'underline',
  'underline-offset-2',
  'dark:text-teal-300',
  'dark:text-teal-400',
  'lesson-img',
])
const APPLICATION_ATTACHMENT_URL =
  /^\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\?cap=[A-Za-z0-9_-]{43}$/i

export type SanitizeDocumentOptions = {
  /** Permit only server-minted, same-origin attachment capability images. */
  allowApplicationImages?: boolean
}

/**
 * Validate the canonical same-origin capability URL returned by the attachment
 * uploader. When an id is supplied, the URL must refer to that exact record.
 */
export function isApplicationAttachmentUrl(value: string, attachmentId?: string): boolean {
  const match = APPLICATION_ATTACHMENT_URL.exec(value)
  return (
    !!match &&
    (attachmentId === undefined || match[1]!.toLowerCase() === attachmentId.toLowerCase())
  )
}

function cssNumber(value: string): number | null {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function cssLength(
  value: string,
  limits: Partial<Record<'px' | 'pt' | 'em' | 'rem' | '%', [number, number]>>,
): boolean {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|pt|em|rem|%)$/i.exec(value)
  if (!match) return false
  const amount = Number(match[1])
  const range = limits[match[2]!.toLowerCase() as keyof typeof limits]
  return !!range && Number.isFinite(amount) && amount >= range[0] && amount <= range[1]
}

function safeColor(value: string): boolean {
  if (/^(?:transparent|currentcolor|inherit)$/i.test(value)) return true
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return true
  return /^(?:rgb|rgba|hsl|hsla)\((?:[\d\s.,%+\-/]|deg|rad|turn)+\)$/i.test(value)
}

function safeFontFamily(value: string): boolean {
  return value.length <= 200 && /^[a-z\d\s,'"._-]+$/i.test(value)
}

function safeFontSize(value: string): boolean {
  if (/^(?:xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i.test(value)) {
    return true
  }
  return cssLength(value, {
    px: [6, 96],
    pt: [4.5, 72],
    em: [0.4, 6],
    rem: [0.4, 6],
    '%': [40, 600],
  })
}

function safeLineHeight(value: string): boolean {
  if (value.toLowerCase() === 'normal') return true
  const unitless = cssNumber(value)
  if (unitless !== null) return unitless >= 0.5 && unitless <= 4
  return cssLength(value, {
    px: [6, 192],
    pt: [4.5, 144],
    em: [0.5, 4],
    rem: [0.5, 4],
    '%': [50, 400],
  })
}

function safeLetterSpacing(value: string): boolean {
  if (value.toLowerCase() === 'normal') return true
  return cssLength(value, {
    px: [-5, 20],
    pt: [-4, 15],
    em: [-0.25, 1],
    rem: [-0.25, 1],
  })
}

function safeTableSize(value: string): boolean {
  if (value.toLowerCase() === 'auto') return true
  return cssLength(value, { px: [1, 4096], pt: [1, 3072], '%': [1, 100] })
}

function safeTextDecoration(value: string): boolean {
  const tokens = value.toLowerCase().split(/\s+/).filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => SAFE_TEXT_DECORATION_TOKENS.has(token))
}

function safeStyleDeclaration(property: string, value: string, tagName: string): boolean {
  switch (property) {
    case 'color':
    case 'background-color':
    case 'text-decoration-color':
      return safeColor(value)
    case 'font-family':
      return safeFontFamily(value)
    case 'font-size':
      return safeFontSize(value)
    case 'font-style':
      return SAFE_FONT_STYLE.has(value.toLowerCase())
    case 'font-weight':
      return /^(?:normal|bold|bolder|lighter|[1-9]00)$/i.test(value)
    case 'letter-spacing':
      return safeLetterSpacing(value)
    case 'line-height':
      return safeLineHeight(value)
    case 'text-align':
      return SAFE_TEXT_ALIGN.has(value.toLowerCase())
    case 'text-decoration':
    case 'text-decoration-line':
      return safeTextDecoration(value)
    case 'text-decoration-style':
      return /^(?:solid|double|dotted|dashed|wavy)$/i.test(value)
    case 'text-transform':
      return SAFE_TEXT_TRANSFORM.has(value.toLowerCase())
    case 'vertical-align':
      return (
        SAFE_VERTICAL_ALIGN.has(value.toLowerCase()) ||
        cssLength(value, {
          px: [-96, 96],
          pt: [-72, 72],
          em: [-6, 6],
          rem: [-6, 6],
          '%': [-600, 600],
        })
      )
    case 'width':
    case 'min-width':
    case 'max-width':
      return TABLE_SIZE_TAGS.has(tagName) && safeTableSize(value)
    default:
      return false
  }
}

function sanitizeInlineStyle(style: string, tagName: string): string {
  if (
    style.length > 2000 ||
    /[\u0000-\u001f\u007f\\@]/.test(style) ||
    /\/\*|!\s*important|(?:url|image-set|expression|var|attr)\s*\(/i.test(style)
  ) {
    return ''
  }

  const clean: string[] = []
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon <= 0) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (!/^[a-z-]+$/.test(property) || !value) continue
    if (safeStyleDeclaration(property, value, tagName)) clean.push(`${property}: ${value}`)
  }
  return clean.join('; ')
}

// Typed structurally so this compiles in DOM-less (worker) tsconfigs too.
interface SanitizedDocumentElement {
  tagName?: string
  innerHTML?: string
  getAttribute(name: string): string | null
  removeAttribute(name: string): void
  setAttribute(name: string, value: string): void
  remove(): void
  querySelectorAll?(selector: string): ArrayLike<SanitizedDocumentElement>
}

export function normalizeDocumentHref(value: string): string | null {
  const href = value.trim()
  if (!href || href.length > 2_048 || /[\u0000-\u0020\u007f\\]/.test(href)) return null
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (/^#[A-Za-z][\w:.-]{0,127}$/.test(href)) return href
  if (/^https:\/\//i.test(href)) {
    return /^https:\/\/(?![^/?#]*@)[^\s]+$/i.test(href) ? href : null
  }
  if (/^mailto:/i.test(href)) return /^mailto:[^@\s]+@[^@\s]+$/i.test(href) ? href : null
  if (/^tel:/i.test(href)) return /^tel:\+?[\d(). -]{3,30}$/i.test(href) ? href : null
  return null
}

function sanitizeDocumentElement(
  el: SanitizedDocumentElement,
  options: SanitizeDocumentOptions,
): void {
  if (el.tagName === 'IMG') {
    const src = el.getAttribute('src')
    if (!options.allowApplicationImages || !src || !isApplicationAttachmentUrl(src)) {
      el.remove()
      return
    }
    const alt = el.getAttribute('alt')
    if (alt && alt.length > 500) el.setAttribute('alt', alt.slice(0, 500))
  }
  // Links opened in a new tab must not leak window.opener (reverse tabnabbing).
  if (el.tagName === 'A') {
    const href = el.getAttribute('href')
    if (href) {
      const cleanHref = normalizeDocumentHref(href)
      if (cleanHref) el.setAttribute('href', cleanHref)
      else el.removeAttribute('href')
    }
    const target = el.getAttribute('target')
    if (target && !['_blank', '_self'].includes(target.toLowerCase())) {
      el.removeAttribute('target')
      el.removeAttribute('rel')
    } else if (target?.toLowerCase() === '_blank') {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    } else {
      el.removeAttribute('rel')
    }
  }
  const style = el.getAttribute('style')
  if (style) {
    const clean = sanitizeInlineStyle(style, el.tagName ?? '')
    if (clean) el.setAttribute('style', clean)
    else el.removeAttribute('style')
  }

  // Class-based utility CSS can create the same full-screen overlays as an
  // inline style. Keep only classes emitted by the active TipTap extensions.
  const classes = el.getAttribute('class')
  if (classes) {
    const clean = classes
      .split(/\s+/)
      .filter((name) => SAFE_RICH_TEXT_CLASSES.has(name))
      .join(' ')
    if (clean) el.setAttribute('class', clean)
    else el.removeAttribute('class')
  }

  const tagName = el.tagName ?? ''
  const dataColor = el.getAttribute('data-color')
  if (dataColor && (tagName !== 'MARK' || !safeColor(dataColor))) {
    el.removeAttribute('data-color')
  }
  const dataType = el.getAttribute('data-type')
  if (
    dataType &&
    !(
      (tagName === 'UL' && dataType === 'taskList') ||
      (tagName === 'LI' && dataType === 'taskItem')
    )
  ) {
    el.removeAttribute('data-type')
  }
  const dataChecked = el.getAttribute('data-checked')
  if (
    dataChecked !== null &&
    (tagName !== 'LI' || !['', 'true', 'false'].includes(dataChecked.toLowerCase()))
  ) {
    el.removeAttribute('data-checked')
  }
  for (const attribute of ['data-comment-id', 'data-suggestion']) {
    const value = el.getAttribute(attribute)
    if (value && !/^[a-z\d_-]{1,128}$/i.test(value)) el.removeAttribute(attribute)
  }
  const colwidth = el.getAttribute('colwidth')
  if (
    colwidth &&
    (!['TD', 'TH'].includes(tagName) ||
      !colwidth
        .split(',')
        .every((value) => /^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= 4096))
  ) {
    el.removeAttribute('colwidth')
  }
  for (const attribute of ['colspan', 'rowspan']) {
    const value = el.getAttribute(attribute)
    if (
      value !== null &&
      (!['TD', 'TH'].includes(tagName) ||
        !/^\d{1,3}$/.test(value) ||
        Number(value) < 1 ||
        Number(value) > 100)
    ) {
      el.removeAttribute(attribute)
    }
  }
  const scope = el.getAttribute('scope')
  if (
    scope !== null &&
    (tagName !== 'TH' || !['row', 'col', 'rowgroup', 'colgroup'].includes(scope.toLowerCase()))
  ) {
    el.removeAttribute('scope')
  }
}

/**
 * Sanitize rich-text document HTML for safe storage and rendering.
 * Returns '' for nullish input. Idempotent — safe to run on write and on render.
 */
export function sanitizeDocumentHtml(
  html: string | null | undefined,
  options: SanitizeDocumentOptions = {},
): string {
  if (!html) return ''
  const allowedTags = options.allowApplicationImages
    ? [...SAFE_DOCUMENT_TAGS, 'img']
    : [...SAFE_DOCUMENT_TAGS]
  const allowedAttributes = options.allowApplicationImages
    ? [...SAFE_DOCUMENT_ATTRIBUTES, 'src', 'alt']
    : [...SAFE_DOCUMENT_ATTRIBUTES]
  const root = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    // Apply the document-specific attribute policy to this returned tree only.
    // A module-level hook would mutate isomorphic-dompurify's shared singleton
    // and corrupt the separate CSS policy used by transactional email.
    RETURN_DOM: true,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  }) as unknown as SanitizedDocumentElement
  for (const element of Array.from(root.querySelectorAll?.('*') ?? [])) {
    sanitizeDocumentElement(element, options)
  }
  return root.innerHTML ?? ''
}
