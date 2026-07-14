// Shared {{token}} resolution over an Item namespace. Two flavours:
//   resolveValue — a mapped value that may be a literal (string/number/bool/null)
//     or a "{{token}}". A whole-string single token keeps its source type, so
//     "{{hours}}" → number and "{{department}}" → number|null. This is what SQL
//     column maps and Sheets cells use.
//   resolveText — pure-string interpolation for templates (HTTP/Slack/email
//     bodies): every {{token}} becomes text, unknown tokens become ''.

import type { Item, Scalar } from './types'

const SINGLE = /^\{\{\s*([\w.]+)\s*\}\}$/
const ANY = /\{\{\s*([\w.]+)\s*\}\}/g

export function resolveValue(expr: unknown, item: Item): Scalar {
  if (expr === null) return null
  if (typeof expr === 'number') return Number.isFinite(expr) ? expr : null
  if (typeof expr === 'boolean') return expr
  if (typeof expr !== 'string') return null
  const single = expr.match(SINGLE)
  if (single) {
    const key = single[1]
    const v = key ? item[key] : undefined
    return v === undefined ? null : v
  }
  if (!expr.includes('{{')) return expr
  return resolveText(expr, item)
}

export function resolveText(tpl: string, item: Item): string {
  return tpl.replace(ANY, (_, k: string) => {
    const v = item[k]
    return v === undefined || v === null ? '' : String(v)
  })
}
