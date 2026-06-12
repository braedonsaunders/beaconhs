// Canvas slide model helpers — shared by the Fabric editor, the ribbon, and
// the legacy→canvas converter. Pure functions over the SlideElement shapes in
// @beaconhs/db/schema (virtual 960×540 stage). No Fabric imports here.

import {
  SLIDE_STAGE,
  isRichRegion,
  type Slide,
  type SlideElement,
  type SlideImageElement,
  type SlideRegion,
  type SlideTextElement,
  type SlideTextRun,
} from '@beaconhs/db/schema'
import { blocksToHtml } from './legacy'

export const STAGE_W = SLIDE_STAGE.width
export const STAGE_H = SLIDE_STAGE.height

// Fonts keyed by the persisted fontFamily preset — used verbatim by the
// Fabric canvas and the HTML renderer so the two stay pixel-consistent.
// Single universal families (no stacks): Fabric builds ctx.font strings and
// measures per-character; multi-font stacks corrupt its width caching when
// per-character styles (bold runs) are present.
export const SLIDE_FONT_CSS: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'Arial',
  serif: 'Georgia',
  mono: 'Menlo',
}

export const genElementId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `e_${Math.random().toString(36).slice(2)}`

// --- runs <-> plain text -----------------------------------------------------

/** Lines of styled runs for a text element; falls back to unstyled `text`. */
export function linesOf(el: SlideTextElement): SlideTextRun[][] {
  if (el.runs && el.runs.length) return el.runs
  return (el.text ?? '').split('\n').map((line) => [{ text: line }])
}

export function runsToPlainText(runs: SlideTextRun[][]): string {
  return runs.map((line) => line.map((r) => r.text).join('')).join('\n')
}

/** True when no run carries any styling — `runs` can then be dropped. */
export function runsAreUniform(runs: SlideTextRun[][]): boolean {
  return runs.every((line) => line.every((r) => !r.bold && !r.italic && !r.underline && !r.color))
}

/** Set text+runs together, dropping `runs` when it adds nothing. */
export function withRuns(el: SlideTextElement, runs: SlideTextRun[][]): SlideTextElement {
  const text = runsToPlainText(runs)
  if (runsAreUniform(runs)) {
    const { runs: _drop, ...rest } = el
    return { ...rest, text }
  }
  return { ...el, text, runs }
}

/** Element-level style change; clears per-run overrides of the same keys so
 * the whole box visibly adopts the new style (PowerPoint box-level toggle). */
export function applyTextStyle(
  el: SlideTextElement,
  patch: Partial<Pick<SlideTextElement, 'bold' | 'italic' | 'underline' | 'color'>>,
): SlideTextElement {
  const next: SlideTextElement = { ...el, ...patch }
  if (!el.runs) return next
  const keys = Object.keys(patch) as (keyof typeof patch)[]
  const runs = el.runs.map((line) =>
    line.map((r) => {
      const copy = { ...r }
      for (const k of keys) delete copy[k]
      return copy
    }),
  )
  return withRuns(next, runs)
}

// --- list (bullet / number) prefixes ----------------------------------------

const LIST_PREFIX_RE = /^(?:[•▪◦‣-]\s+|\d{1,3}[.)]\s+)/

function stripPrefixFromLine(line: SlideTextRun[]): SlideTextRun[] {
  const plain = line.map((r) => r.text).join('')
  const m = LIST_PREFIX_RE.exec(plain)
  if (!m) return line
  let remaining = m[0].length
  const out: SlideTextRun[] = []
  for (const run of line) {
    if (remaining <= 0) {
      out.push(run)
      continue
    }
    if (run.text.length <= remaining) {
      remaining -= run.text.length
      continue
    }
    out.push({ ...run, text: run.text.slice(remaining) })
    remaining = 0
  }
  return out.length ? out : [{ text: '' }]
}

function prefixForLine(list: 'bullet' | 'number', index: number): string {
  return list === 'bullet' ? '• ' : `${index + 1}. `
}

/** Toggle / normalize literal list markers on every line of a text element.
 * Markers are part of the text so the canvas, player, and PPT mental model
 * all agree on what's on the slide. */
export function applyListStyle(
  el: SlideTextElement,
  list: 'bullet' | 'number' | undefined,
): SlideTextElement {
  const stripped = linesOf(el).map(stripPrefixFromLine)
  if (!list) {
    const { list: _drop, ...rest } = el
    return withRuns(rest as SlideTextElement, stripped)
  }
  let n = 0
  const runs = stripped.map((line) => {
    const plain = line.map((r) => r.text).join('')
    if (!plain.trim()) return line
    const prefix = prefixForLine(list, n++)
    const [first, ...others] = line
    return [{ ...(first ?? { text: '' }), text: prefix + (first?.text ?? '') }, ...others]
  })
  return withRuns({ ...el, list }, runs)
}

/** After inline editing: re-apply markers so new lines typed mid-list pick
 * them up and numbering stays sequential. */
export function normalizeListPrefixes(el: SlideTextElement): SlideTextElement {
  if (!el.list) return el
  return applyListStyle(el, el.list)
}

// --- legacy structured slides → canvas ---------------------------------------

const LEGACY_BG: Record<NonNullable<Slide['bg']>, { bg: string; text: string; muted: string }> = {
  white: { bg: '#ffffff', text: '#0f172a', muted: '#64748b' },
  slate: { bg: '#f1f5f9', text: '#0f172a', muted: '#64748b' },
  teal: { bg: '#134e4a', text: '#ffffff', muted: '#e2e8f0' },
  dark: { bg: '#0f172a', text: '#ffffff', muted: '#e2e8f0' },
}

type ParsedRegion = { runs: SlideTextRun[][]; images: string[] }

/** Flatten a TipTap-HTML region into styled lines (DOM-walk; client only —
 * conversion happens inside the editor). Lists keep literal markers, tables
 * flatten to "cell | cell" rows, inline images come back separately. */
function parseRegionHtml(html: string): ParsedRegion {
  const images: string[] = []
  if (typeof DOMParser === 'undefined' || !html.trim()) return { runs: [], images }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const lines: SlideTextRun[][] = []
  let current: SlideTextRun[] = []

  const flush = () => {
    if (current.length) {
      lines.push(current)
      current = []
    }
  }
  // Block starts must NOT flush a line holding only a pending list marker —
  // TipTap wraps list-item text in a nested <p> (<li><p>text</p></li>).
  const blockFlush = () => {
    const plain = current.map((r) => r.text).join('')
    if (/^\s*(?:[•·‣◦-]|\d{1,3}[.)])?\s*$/.test(plain)) return
    flush()
  }
  const pushText = (text: string, style: Omit<SlideTextRun, 'text'>) => {
    const clean = text.replace(/\s+/g, ' ')
    if (!clean) return
    current.push({ text: clean, ...style })
  }

  type Inline = { bold?: boolean; italic?: boolean; underline?: boolean; color?: string }
  const walk = (node: Node, inline: Inline, listStack: ('bullet' | 'number')[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? '', inline)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const elNode = node as HTMLElement
    const tag = elNode.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style') return
    if (tag === 'br') {
      flush()
      return
    }
    if (tag === 'img') {
      const src = elNode.getAttribute('src') ?? ''
      if (/^https?:\/\//.test(src)) images.push(src)
      return
    }
    const nextInline: Inline = { ...inline }
    if (tag === 'b' || tag === 'strong' || /^h[1-6]$/.test(tag)) nextInline.bold = true
    if (tag === 'i' || tag === 'em') nextInline.italic = true
    if (tag === 'u' || tag === 'a') nextInline.underline = true
    const color = elNode.style?.color
    if (color) {
      const hex = cssColorToHex(color)
      if (hex) nextInline.color = hex
    }
    const isBlock = /^(p|div|h[1-6]|li|blockquote|tr|pre|ul|ol|table|figure|hr)$/.test(tag)
    if (isBlock) blockFlush()
    if (tag === 'hr') {
      lines.push([{ text: '———' }])
      return
    }
    const nextList: ('bullet' | 'number')[] =
      tag === 'ul' ? [...listStack, 'bullet'] : tag === 'ol' ? [...listStack, 'number'] : listStack
    if (tag === 'li') {
      const depth = Math.max(0, nextList.length - 1)
      const kind = nextList[nextList.length - 1] ?? 'bullet'
      current.push({ text: `${'   '.repeat(depth)}${kind === 'bullet' ? '• ' : '· '}` })
    }
    if (tag === 'tr') {
      const cells = Array.from(elNode.children).map((c) => (c.textContent ?? '').trim())
      pushText(cells.filter(Boolean).join('  |  '), inline)
      flush()
      return
    }
    elNode.childNodes.forEach((child) => walk(child, nextInline, nextList))
    if (isBlock) flush()
  }

  doc.body.childNodes.forEach((node) => walk(node, {}, []))
  flush()
  // Trim leading/trailing blank lines but keep interior spacing.
  while (lines.length && !lines[0]!.some((r) => r.text.trim())) lines.shift()
  while (lines.length && !lines[lines.length - 1]!.some((r) => r.text.trim())) lines.pop()
  return { runs: lines, images }
}

function cssColorToHex(value: string): string | undefined {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value)
  if (!m) return undefined
  const to2 = (n: string) => Number(n).toString(16).padStart(2, '0')
  return `#${to2(m[1]!)}${to2(m[2]!)}${to2(m[3]!)}`
}

function regionToHtml(region: SlideRegion | undefined): string {
  if (!region) return ''
  if (isRichRegion(region)) return region.html
  return blocksToHtml(region)
}

function textElement(
  partial: Omit<SlideTextElement, 'id' | 'kind' | 'text'> & { runs?: SlideTextRun[][] },
  text = '',
): SlideTextElement {
  const el: SlideTextElement = { id: genElementId(), kind: 'text', text, ...partial }
  return partial.runs ? withRuns(el, partial.runs) : el
}

function regionTextElement(
  region: SlideRegion | undefined,
  box: { x: number; y: number; w: number; h: number },
  style: { fontSize: number; color: string; align?: 'left' | 'center' | 'right' },
): { text: SlideTextElement | null; images: SlideImageElement[] } {
  const parsed = parseRegionHtml(regionToHtml(region))
  const images: SlideImageElement[] = parsed.images.slice(0, 4).map((url, i) => ({
    id: genElementId(),
    kind: 'image',
    url,
    x: box.x + box.w - 260 - i * 16,
    y: box.y + box.h - 180 - i * 16,
    w: 240,
    h: 160,
    fit: 'contain',
  }))
  if (!parsed.runs.length) return { text: null, images }
  return {
    text: textElement({ ...box, ...style, lineHeight: 1.35, runs: parsed.runs }),
    images,
  }
}

function imageElement(
  box: { x: number; y: number; w: number; h: number },
  opts: Partial<SlideImageElement> = {},
): SlideImageElement {
  return { id: genElementId(), kind: 'image', ...box, ...opts }
}

/** Convert one legacy structured slide to a canvas slide. Canvas slides pass
 * through unchanged. Geometry mirrors the legacy SlideView CSS so converted
 * decks look the same in the player. */
export function ensureCanvasSlide(slide: Slide): Slide {
  if (slide.layout === 'canvas') return slide
  const theme = LEGACY_BG[slide.bg ?? 'white']
  const elements: SlideElement[] = []
  const title = slide.title?.trim()
  const subtitle = slide.subtitle?.trim()

  if (slide.layout === 'pptx') {
    if (slide.imageAttachmentId) {
      elements.push(
        imageElement(
          { x: 0, y: 0, w: STAGE_W, h: STAGE_H },
          { attachmentId: slide.imageAttachmentId, fit: 'contain', locked: true },
        ),
      )
    }
    return { id: slide.id, layout: 'canvas', elements, bgColor: '#ffffff', notes: slide.notes }
  }

  if (slide.layout === 'title') {
    elements.push(
      textElement(
        {
          x: 77,
          y: 200,
          w: 806,
          h: 70,
          fontSize: 44,
          bold: true,
          color: theme.text,
          align: 'center',
        },
        title || 'Title slide',
      ),
    )
    if (subtitle) {
      elements.push(
        textElement(
          { x: 77, y: 290, w: 806, h: 36, fontSize: 21, color: theme.muted, align: 'center' },
          subtitle,
        ),
      )
    }
  }

  if (slide.layout === 'title-content') {
    if (title) {
      elements.push(
        textElement(
          { x: 67, y: 32, w: 826, h: 48, fontSize: 30, bold: true, color: theme.text },
          title,
        ),
      )
    }
    const { text, images } = regionTextElement(
      slide.body,
      { x: 67, y: title ? 104 : 48, w: 826, h: title ? 404 : 444 },
      { fontSize: 20, color: theme.text },
    )
    if (text) elements.push(text)
    elements.push(...images)
  }

  if (slide.layout === 'two-col') {
    if (title) {
      elements.push(
        textElement(
          { x: 67, y: 32, w: 826, h: 48, fontSize: 30, bold: true, color: theme.text },
          title,
        ),
      )
    }
    const top = title ? 104 : 48
    const colH = title ? 404 : 444
    for (const [region, x] of [
      [slide.left, 67],
      [slide.right, 504],
    ] as const) {
      const { text, images } = regionTextElement(
        region,
        { x, y: top, w: 389, h: colH },
        { fontSize: 19, color: theme.text },
      )
      if (text) elements.push(text)
      elements.push(...images)
    }
  }

  if (slide.layout === 'image-text') {
    elements.push(
      imageElement(
        { x: 0, y: 0, w: 480, h: 540 },
        slide.imageAttachmentId ? { attachmentId: slide.imageAttachmentId, fit: 'cover' } : {},
      ),
    )
    if (title) {
      elements.push(
        textElement(
          { x: 518, y: 43, w: 403, h: 44, fontSize: 26, bold: true, color: theme.text },
          title,
        ),
      )
    }
    const { text, images } = regionTextElement(
      slide.body,
      { x: 518, y: title ? 104 : 56, w: 403, h: title ? 392 : 440 },
      { fontSize: 18, color: theme.text },
    )
    if (text) elements.push(text)
    elements.push(...images)
  }

  if (slide.layout === 'image-full') {
    elements.push(
      imageElement(
        { x: 0, y: 0, w: STAGE_W, h: STAGE_H },
        slide.imageAttachmentId ? { attachmentId: slide.imageAttachmentId, fit: 'cover' } : {},
      ),
    )
    if (title || subtitle) {
      elements.push({
        id: genElementId(),
        kind: 'shape',
        shape: 'rect',
        x: 0,
        y: 396,
        w: STAGE_W,
        h: 144,
        fill: '#000000',
        opacity: 0.45,
        strokeWidth: 0,
      })
      if (title) {
        elements.push(
          textElement(
            { x: 67, y: 420, w: 826, h: 44, fontSize: 30, bold: true, color: '#ffffff' },
            title,
          ),
        )
      }
      if (subtitle) {
        elements.push(
          textElement({ x: 67, y: 472, w: 826, h: 28, fontSize: 17, color: '#e2e8f0' }, subtitle),
        )
      }
    }
  }

  return { id: slide.id, layout: 'canvas', elements, bgColor: theme.bg, notes: slide.notes }
}

export function ensureCanvasDeck(slides: Slide[]): Slide[] {
  return (slides ?? []).map(ensureCanvasSlide)
}

// --- new-slide templates ------------------------------------------------------

export type SlideTemplate =
  | 'blank'
  | 'title'
  | 'title-content'
  | 'two-col'
  | 'image-text'
  | 'image-full'

export const SLIDE_TEMPLATES: { value: SlideTemplate; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'title-content', label: 'Title + content' },
  { value: 'two-col', label: 'Two columns' },
  { value: 'image-text', label: 'Image + text' },
  { value: 'image-full', label: 'Full image' },
  { value: 'blank', label: 'Blank' },
]

const TEMPLATE_BODY = '• First point\n• Second point\n• Third point'

export function createCanvasSlide(template: SlideTemplate, slideId: string): Slide {
  const elements: SlideElement[] = []
  const dark = '#0f172a'
  if (template === 'title') {
    elements.push(
      textElement(
        { x: 77, y: 200, w: 806, h: 70, fontSize: 44, bold: true, color: dark, align: 'center' },
        'Title slide',
      ),
      textElement(
        { x: 77, y: 290, w: 806, h: 36, fontSize: 21, color: '#64748b', align: 'center' },
        'Add a subtitle',
      ),
    )
  }
  if (template === 'title-content') {
    elements.push(
      textElement(
        { x: 67, y: 32, w: 826, h: 48, fontSize: 30, bold: true, color: dark },
        'Slide title',
      ),
      textElement(
        {
          x: 67,
          y: 110,
          w: 826,
          h: 360,
          fontSize: 22,
          color: dark,
          lineHeight: 1.5,
          list: 'bullet',
        },
        TEMPLATE_BODY,
      ),
    )
  }
  if (template === 'two-col') {
    elements.push(
      textElement(
        { x: 67, y: 32, w: 826, h: 48, fontSize: 30, bold: true, color: dark },
        'Slide title',
      ),
      textElement(
        {
          x: 67,
          y: 110,
          w: 389,
          h: 360,
          fontSize: 20,
          color: dark,
          lineHeight: 1.5,
          list: 'bullet',
        },
        TEMPLATE_BODY,
      ),
      textElement(
        {
          x: 504,
          y: 110,
          w: 389,
          h: 360,
          fontSize: 20,
          color: dark,
          lineHeight: 1.5,
          list: 'bullet',
        },
        TEMPLATE_BODY,
      ),
    )
  }
  if (template === 'image-text') {
    elements.push(
      imageElement({ x: 0, y: 0, w: 480, h: 540 }),
      textElement(
        { x: 518, y: 48, w: 403, h: 44, fontSize: 26, bold: true, color: dark },
        'Slide title',
      ),
      textElement(
        { x: 518, y: 110, w: 403, h: 360, fontSize: 18, color: dark, lineHeight: 1.5 },
        'Add your content',
      ),
    )
  }
  if (template === 'image-full') {
    elements.push(
      imageElement({ x: 0, y: 0, w: STAGE_W, h: STAGE_H }),
      {
        id: genElementId(),
        kind: 'shape',
        shape: 'rect',
        x: 0,
        y: 396,
        w: STAGE_W,
        h: 144,
        fill: '#000000',
        opacity: 0.45,
        strokeWidth: 0,
      },
      textElement(
        { x: 67, y: 430, w: 826, h: 44, fontSize: 30, bold: true, color: '#ffffff' },
        'Slide title',
      ),
    )
  }
  return { id: slideId, layout: 'canvas', elements, bgColor: '#ffffff' }
}

// --- insertables (ribbon) -----------------------------------------------------

export function newTextElement(): SlideTextElement {
  return textElement({ x: 120, y: 120, w: 420, h: 46, fontSize: 24, color: '#0f172a' }, 'New text')
}

export function newShapeElement(shape: 'rect' | 'ellipse' | 'line'): SlideElement {
  if (shape === 'line') {
    return {
      id: genElementId(),
      kind: 'shape',
      shape,
      x: 160,
      y: 270,
      w: 320,
      h: 0,
      stroke: '#0f172a',
      strokeWidth: 3,
    }
  }
  return {
    id: genElementId(),
    kind: 'shape',
    shape,
    x: 160,
    y: 160,
    w: 260,
    h: 160,
    fill: '#ccfbf1',
    stroke: '#0f766e',
    strokeWidth: 2,
    radius: shape === 'rect' ? 8 : 0,
  }
}

export function newImageElement(
  attachmentId: string,
  natural: { width: number; height: number } | null,
): SlideImageElement {
  const maxW = 480
  const maxH = 360
  let w = maxW
  let h = maxH * 0.75
  if (natural && natural.width > 0 && natural.height > 0) {
    const scale = Math.min(maxW / natural.width, maxH / natural.height, 1)
    w = Math.round(natural.width * scale)
    h = Math.round(natural.height * scale)
  }
  return {
    id: genElementId(),
    kind: 'image',
    attachmentId,
    x: Math.round((STAGE_W - w) / 2),
    y: Math.round((STAGE_H - h) / 2),
    w,
    h,
    fit: 'stretch',
  }
}
