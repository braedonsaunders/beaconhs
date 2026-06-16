// Conditional formatting — the shared cell-coloring engine used by both the
// table and the pivot/matrix renderers. Pure (no React): maps a value + a set of
// rules to Tailwind class strings (and, for color scales, an inline rgba style).
//
// The default RAG palette reproduces the hand-built training-matrix colors, so a
// pivot over `coverage_status` lights up green/amber/red/grey out of the box.

export type CfColorToken = 'green' | 'amber' | 'red' | 'grey' | 'teal' | 'blue' | 'slate'

export type CfRule =
  | {
      type: 'threshold'
      column: string
      op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'between'
      value: number
      value2?: number
      color: CfColorToken
    }
  | {
      type: 'colorScale'
      column: string
      min: number
      max: number
      mid?: number
      minColor: CfColorToken
      midColor?: CfColorToken
      maxColor: CfColorToken
    }
  | { type: 'discrete'; column: string; map: Record<string, CfColorToken> }

export type CfStyle = {
  /** Tailwind classes for background + text (light + dark). */
  className?: string
  /** Inline background (color-scale interpolation only). */
  backgroundColor?: string
}

const TOKEN_CLASS: Record<CfColorToken, string> = {
  green: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  grey: 'text-slate-400 dark:text-slate-500',
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

/** rgb anchors for the color-scale interpolation tokens. */
const TOKEN_RGB: Record<CfColorToken, [number, number, number]> = {
  green: [34, 197, 94],
  amber: [245, 158, 11],
  red: [239, 68, 68],
  grey: [148, 163, 184],
  teal: [20, 184, 166],
  blue: [59, 130, 246],
  slate: [100, 116, 139],
}

/** The RAG mapping the training matrix uses — handy default for a discrete rule. */
export const RAG_DISCRETE: Record<string, CfColorToken> = {
  valid: 'green',
  no_expiry: 'green',
  expiring: 'amber',
  expired: 'red',
  missing: 'grey',
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function scaleColor(rule: Extract<CfRule, { type: 'colorScale' }>, n: number): string {
  const { min, max, mid } = rule
  const clamp = Math.max(min, Math.min(max, n))
  const lo = TOKEN_RGB[rule.minColor]
  const hi = TOKEN_RGB[rule.maxColor]
  const midColor = rule.midColor ? TOKEN_RGB[rule.midColor] : null
  let from = lo
  let to = hi
  let t: number
  if (midColor && typeof mid === 'number') {
    if (clamp <= mid) {
      from = lo
      to = midColor
      t = mid === min ? 0 : (clamp - min) / (mid - min)
    } else {
      from = midColor
      to = hi
      t = max === mid ? 1 : (clamp - mid) / (max - mid)
    }
  } else {
    t = max === min ? 0 : (clamp - min) / (max - min)
  }
  const r = lerp(from[0], to[0], t)
  const g = lerp(from[1], to[1], t)
  const b = lerp(from[2], to[2], t)
  // Soft fill so text stays legible; the renderer pairs this with a neutral text color.
  return `rgba(${r}, ${g}, ${b}, 0.18)`
}

/** Resolve the cell style for a value under the rules that target `column`.
 *  Returns an empty object when no rule applies. */
export function resolveCellStyle(value: unknown, column: string, rules: CfRule[]): CfStyle {
  for (const rule of rules) {
    if (rule.column !== column) continue
    if (rule.type === 'discrete') {
      const token = rule.map[String(value)]
      if (token) return { className: TOKEN_CLASS[token] }
      continue
    }
    const n = Number(value)
    if (!Number.isFinite(n)) continue
    if (rule.type === 'threshold') {
      const hit =
        rule.op === 'gt'
          ? n > rule.value
          : rule.op === 'gte'
            ? n >= rule.value
            : rule.op === 'lt'
              ? n < rule.value
              : rule.op === 'lte'
                ? n <= rule.value
                : rule.op === 'eq'
                  ? n === rule.value
                  : n >= rule.value && n <= (rule.value2 ?? rule.value)
      if (hit) return { className: TOKEN_CLASS[rule.color] }
      continue
    }
    // colorScale
    return { backgroundColor: scaleColor(rule, n) }
  }
  return {}
}

/** Class string for a named token (for legends/swatches). */
export function cfTokenClass(token: CfColorToken): string {
  return TOKEN_CLASS[token]
}
