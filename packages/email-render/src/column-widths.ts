// Content-aware column widths for the tables in PDF and email templates.
//
// A template table is authored before any record exists, so its widths cannot
// come from real data. They come from what the table SAYS: the column headings
// and the cell markup — literal text plus {{tokens}}, each estimated from the
// field's value kind (or, without one, from its key). The result is a set of
// percentages for the <colgroup> that `table-layout:fixed` reads, so the
// builder canvas, the Paged.js preview and the worker PDF all lay the table out
// from the same numbers.
//
// Sizing follows the shape of CSS automatic table layout: every column first
// gets its minimum (the longest unbreakable run — a date, a number, a heading's
// longest word), then the space left over is shared in proportion to how much
// more each column could use. Short, fixed-width values stay narrow; free text
// absorbs the slack.

export type ColumnValueKind =
  'text' | 'long_text' | 'number' | 'date' | 'datetime' | 'bool' | 'enum' | 'person' | 'org_unit'

export type ColumnSample = {
  /** Plain text of the column's heading cell(s). */
  header: string
  /** Raw text of the column's body cells — literals and {{tokens}}. */
  cells: readonly string[]
}

export type AutoColumnOptions = {
  /** Value kinds by field key (the token's last path segment). "text" defers to the key. */
  kinds?: Readonly<Record<string, ColumnValueKind>>
  /** Characters of body text that fit across the table. */
  budgetChars?: number
}

type Extent = { min: number; max: number }

const DEFAULT_BUDGET_CHARS = 100
/** Cell padding and borders, in characters, added to every column. */
const CELL_PADDING_CHARS = 2
const MIN_COLUMN_PCT = 3

const KIND_EXTENT: Record<ColumnValueKind, Extent> = {
  number: { min: 5, max: 8 },
  date: { min: 10, max: 12 },
  datetime: { min: 10, max: 19 },
  bool: { min: 3, max: 4 },
  enum: { min: 7, max: 12 },
  person: { min: 9, max: 20 },
  org_unit: { min: 9, max: 22 },
  text: { min: 7, max: 16 },
  long_text: { min: 10, max: 48 },
}

const NAME_HINTS: { pattern: RegExp; extent: Extent }[] = [
  { pattern: /^(is|has|can|was|should)_|(^|_)(yes_no|flag)($|_)/, extent: KIND_EXTENT.bool },
  {
    pattern: /(^|_)(at|datetime|timestamp)$|(^|_)(created|updated|started|ended)_at/,
    extent: KIND_EXTENT.datetime,
  },
  { pattern: /(^|_)(date|on|expires|expiry|due|dob)($|_)/, extent: KIND_EXTENT.date },
  { pattern: /(^|_)(weekday|day_name)($|_)/, extent: { min: 3, max: 9 } },
  { pattern: /(^|_)time($|_)/, extent: { min: 5, max: 8 } },
  {
    pattern:
      /(^|_)(km|kms|mi|qty|quantity|count|total|totals|hours|hrs|odometer|odo|amount|score|percent|pct|cost|price|rate|minutes|mins|days|day|number|num|no|index|sequence|seq|year|month|weight|kg|lbs|age)($|_)/,
    extent: KIND_EXTENT.number,
  },
  { pattern: /(^|_)(email)($|_)/, extent: { min: 12, max: 26 } },
  { pattern: /(^|_)(phone|mobile|tel|fax)($|_)/, extent: { min: 10, max: 14 } },
  { pattern: /(^|_)(url|link|href|filename|file)($|_)/, extent: { min: 10, max: 30 } },
  { pattern: /(^|_)(signature|signed)($|_)/, extent: { min: 14, max: 22 } },
  {
    pattern: /(^|_)(reference|ref|code|tag|serial|id|asset_tag|plate|licen[cs]e|unit)($|_)/,
    extent: { min: 8, max: 12 },
  },
  {
    pattern:
      /(^|_)(status|type|kind|label|result|severity|category|level|priority|grade|rating|outcome|role)($|_)/,
    extent: KIND_EXTENT.enum,
  },
  {
    pattern:
      /(^|_)(description|notes?|comments?|details?|narrative|summary|reason|actions?|cause|destination|address|remarks|findings|instructions|text|body|observations?|hazards?|controls?|steps?|measures?|explanation|answer|response|feedback|issue|problem|corrective|recommendations?)($|_)/,
    extent: KIND_EXTENT.long_text,
  },
  {
    pattern:
      /(^|_)(name|title|site|location|customer|project|vehicle|driver|equipment|item|course|task|person|employee|worker|inspector|supervisor|company|department|provider|model|make|area)($|_)/,
    extent: { min: 8, max: 24 },
  },
]

const TOKEN = /\{\{\{?\s*([^{}]*?)\s*\}?\}\}/g

/** Visible text of a fragment of cell markup: no tags, entities as one character. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|\u00a0/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenExtent(
  path: string,
  kinds: Readonly<Record<string, ColumnValueKind>>,
): Extent | null {
  // Block helpers and comments print nothing themselves.
  if (/^[#/^!>]|^else\b/.test(path)) return null
  const key =
    path
      .replace(/^(this\.|\.\.\/)+/, '')
      .split(/[.\s]/)
      .filter(Boolean)
      .pop() ?? ''
  if (!key) return null
  if (key === '@index' || key === '@number') return { min: 2, max: 3 }
  const kind = kinds[key]
  // Plain "text" says nothing about length; the key still can (notes vs code).
  if (kind && kind !== 'text') return KIND_EXTENT[kind]
  const name = key.replace(/^@/, '').toLowerCase()
  return NAME_HINTS.find((hint) => hint.pattern.test(name))?.extent ?? KIND_EXTENT.text
}

function longestWord(text: string): number {
  return text.split(/\s+/).reduce((longest, word) => Math.max(longest, word.length), 0)
}

function cellExtent(raw: string, kinds: Readonly<Record<string, ColumnValueKind>>): Extent | null {
  let min = 0
  let max = 0
  let literal = ''
  let offset = 0
  let printed = false
  for (const match of raw.matchAll(TOKEN)) {
    literal += raw.slice(offset, match.index)
    offset = match.index + match[0].length
    const extent = tokenExtent(match[1] ?? '', kinds)
    if (!extent) continue
    printed = true
    min = Math.max(min, extent.min)
    max += extent.max
  }
  literal += raw.slice(offset)
  const text = visibleText(literal)
  if (!printed && !text) return null
  return {
    min: Math.max(min, longestWord(text)),
    max: max + text.length,
  }
}

/** A heading may wrap onto a second line rather than widen its column. */
function headerExtent(header: string): Extent {
  const text = visibleText(header)
  const word = longestWord(text)
  return { min: word, max: Math.max(word, Math.ceil(text.length / 2)) }
}

function columnExtent(
  column: ColumnSample,
  kinds: Readonly<Record<string, ColumnValueKind>>,
): Extent {
  const head = headerExtent(column.header)
  const cells = column.cells
    .map((cell) => cellExtent(cell, kinds))
    .filter((extent): extent is Extent => extent !== null)
  if (cells.length === 0) {
    // A blank column (a box to write in, a signature line) has nothing to
    // measure; give it room for its heading and a hand-written entry.
    const roomy = Math.max(head.max, visibleText(column.header).length, 12)
    return { min: Math.max(head.min, 6), max: roomy }
  }
  const min = Math.max(head.min, ...cells.map((cell) => cell.min), 2)
  const max = Math.max(min, head.max, ...cells.map((cell) => cell.max))
  return { min, max }
}

/** Round to one decimal place while keeping the total exactly 100. */
function roundToHundred(shares: number[]): number[] {
  const total = shares.reduce((sum, share) => sum + share, 0)
  if (total <= 0) return shares.map(() => Math.round((100 / shares.length) * 10) / 10)
  const tenths = shares.map((share) => Math.floor((share / total) * 1000))
  let remainder = 1000 - tenths.reduce((sum, value) => sum + value, 0)
  const order = shares
    .map((share, index) => ({ index, frac: (share / total) * 1000 - tenths[index]! }))
    .sort((a, b) => b.frac - a.frac)
  for (let i = 0; remainder > 0; i = (i + 1) % order.length, remainder--) {
    tenths[order[i]!.index]! += 1
  }
  return tenths.map((value) => value / 10)
}

/** Lift any column under the floor, taking the difference from the widest ones. */
function enforceFloor(percents: number[], floor: number): number[] {
  if (floor * percents.length > 100) return percents.map(() => 100 / percents.length)
  const out = [...percents]
  for (;;) {
    const short = out.reduce((sum, pct) => sum + Math.max(0, floor - pct), 0)
    if (short <= 1e-9) return out
    const donors = out.map((pct) => Math.max(0, pct - floor))
    const pool = donors.reduce((sum, value) => sum + value, 0)
    for (let i = 0; i < out.length; i++) {
      out[i] = out[i]! < floor ? floor : out[i]! - (short * donors[i]!) / pool
    }
  }
}

/**
 * Percentage widths for a table's columns, in column order, totalling 100.
 */
export function autoColumnPercents(
  columns: readonly ColumnSample[],
  options: AutoColumnOptions = {},
): number[] {
  if (columns.length === 0) return []
  if (columns.length === 1) return [100]
  const kinds = options.kinds ?? {}
  const budget = Math.max(options.budgetChars ?? DEFAULT_BUDGET_CHARS, columns.length)
  const extents = columns.map((column) => {
    const extent = columnExtent(column, kinds)
    return { min: extent.min + CELL_PADDING_CHARS, max: extent.max + CELL_PADDING_CHARS }
  })
  const sumMin = extents.reduce((sum, e) => sum + e.min, 0)
  const sumMax = extents.reduce((sum, e) => sum + e.max, 0)
  let widths: number[]
  if (sumMax <= budget) {
    // Everything fits at its preferred width: share the surplus the same way.
    widths = extents.map((e) => e.max)
  } else if (sumMin >= budget) {
    widths = extents.map((e) => e.min)
  } else {
    const ratio = (budget - sumMin) / (sumMax - sumMin)
    widths = extents.map((e) => e.min + (e.max - e.min) * ratio)
  }
  const total = widths.reduce((sum, width) => sum + width, 0)
  const floor = Math.min(MIN_COLUMN_PCT, 100 / columns.length)
  return roundToHundred(
    enforceFloor(
      widths.map((width) => (width / total) * 100),
      floor,
    ),
  )
}

/** The `<colgroup>` for a set of percentages — what `table-layout:fixed` reads. */
export function colgroupHtml(percents: readonly number[]): string {
  return `<colgroup>${percents.map((pct) => `<col style="width:${pct}%" />`).join('')}</colgroup>`
}
