import { htmlToText } from '@beaconhs/forms-core'

/** Convert a text-only header/footer template to a safe CSS `content` value. */
export function pdfPageCssContent(tpl: string, sample: Record<string, unknown>): string {
  if (!tpl.trim()) return '""'
  const text = htmlToText(tpl)
  const out: string[] = []
  let literal = ''
  let cursor = 0
  const flushLiteral = () => {
    if (literal) {
      out.push(JSON.stringify(literal))
      literal = ''
    }
  }
  for (const match of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    literal += text.slice(cursor, match.index)
    const key = match[1]!
    if (key === 'page' || key === 'pages') {
      flushLiteral()
      out.push(key === 'pages' ? 'counter(pages)' : 'counter(page)')
    } else {
      literal += String(sample[key] ?? '')
    }
    cursor = match.index + match[0].length
  }
  literal += text.slice(cursor)
  flushLiteral()
  return out.length ? out.join(' ') : '""'
}
