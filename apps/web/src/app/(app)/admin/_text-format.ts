// The model behind the template builders' text-format bar: what a selected
// element's text currently looks like (read from its computed style, so
// inherited formatting shows — a <th> is already bold) and the style patch a
// change makes. Pure, so the GrapesJS wiring stays thin and this stays tested.

export type TextAlign = 'left' | 'center' | 'right'

export type TextFormat = {
  bold: boolean
  italic: boolean
  underline: boolean
  fontSizePx: number
  /** #rrggbb, as an <input type="color"> wants it. */
  color: string
  align: TextAlign
  /** Whether alignment means anything (an inline value has no line box of its own). */
  block: boolean
}

export type TextFormatChange = Partial<
  Pick<TextFormat, 'bold' | 'italic' | 'underline' | 'fontSizePx' | 'color' | 'align'>
>

/** Every property the bar writes — and so what "Clear text formatting" removes. */
export const TEXT_FORMAT_PROPERTIES = [
  'font-weight',
  'font-style',
  'text-decoration',
  'font-size',
  'color',
  'text-align',
] as const

type ComputedTextStyle = Pick<
  CSSStyleDeclaration,
  'fontWeight' | 'fontStyle' | 'textDecorationLine' | 'fontSize' | 'color' | 'textAlign' | 'display'
>

const NOT_TEXT = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'colgroup',
  'col',
  'hr',
  'br',
  'img',
  'video',
  'audio',
  'iframe',
  'svg',
  'body',
])
const NOT_TEXT_TYPES = new Set(['wrapper', 'image', 'video', 'iframe', 'map', 'svg'])

/** Whether the bar applies to a component: text-bearing and stylable. */
export function isFormattable(cmp: { get(name: string): unknown }): boolean {
  if (cmp.get('stylable') === false) return false
  if (NOT_TEXT_TYPES.has(String(cmp.get('type') ?? ''))) return false
  return !NOT_TEXT.has(String(cmp.get('tagName') ?? '').toLowerCase())
}

function hexByte(value: string): string {
  return Math.max(0, Math.min(255, Math.round(Number(value))))
    .toString(16)
    .padStart(2, '0')
}

/** A computed colour (rgb()/rgba()/#hex) as #rrggbb. */
export function colorToHex(color: string): string {
  const value = color.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  if (/^#[0-9a-f]{6}$/.test(value)) return value
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value)
  if (rgb) return `#${hexByte(rgb[1]!)}${hexByte(rgb[2]!)}${hexByte(rgb[3]!)}`
  return '#000000'
}

function alignOf(textAlign: string): TextAlign {
  if (textAlign === 'center') return 'center'
  if (textAlign === 'right' || textAlign === 'end') return 'right'
  return 'left'
}

export function readTextFormat(style: ComputedTextStyle): TextFormat {
  const weight = style.fontWeight === 'bold' ? 700 : Number(style.fontWeight) || 400
  return {
    bold: weight >= 600,
    italic: style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique'),
    underline: style.textDecorationLine.split(/\s+/).includes('underline'),
    fontSizePx: Math.round((parseFloat(style.fontSize) || 13) * 10) / 10,
    color: colorToHex(style.color),
    align: alignOf(style.textAlign),
    block: style.display !== 'inline',
  }
}

/**
 * The element's own style after a change. Only the changed properties are
 * written; everything else the element declares is kept as it was.
 */
export function textFormatPatch(
  own: Readonly<Record<string, string>>,
  current: TextFormat,
  change: TextFormatChange,
): Record<string, string> {
  const next: Record<string, string> = { ...own }
  if (change.bold !== undefined) next['font-weight'] = change.bold ? '700' : '400'
  if (change.italic !== undefined) next['font-style'] = change.italic ? 'italic' : 'normal'
  if (change.underline !== undefined) {
    next['text-decoration'] = change.underline ? 'underline' : 'none'
  }
  if (change.fontSizePx !== undefined && change.fontSizePx !== current.fontSizePx) {
    const px = Math.max(6, Math.min(96, Math.round(change.fontSizePx * 10) / 10))
    next['font-size'] = `${px}px`
  }
  if (change.color !== undefined && /^#[0-9a-f]{6}$/i.test(change.color)) {
    next.color = change.color.toLowerCase()
  }
  if (change.align !== undefined) next['text-align'] = change.align
  return next
}
