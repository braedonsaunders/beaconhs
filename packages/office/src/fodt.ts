// Exact-match text surgery on Flat ODT (.fodt) XML — the precision-edit
// backend for the document AI agent. The DOCX master round-trips through
// LibreOffice (docx → fodt → edit → docx), and the edits splice plain-text
// find/replace across formatting runs without disturbing any markup, so
// character styles, lists, tables and images all survive.
//
// Matching model: the fodt is tokenized into tag and text tokens. Text tokens
// (entity-decoded) plus whitespace pseudo-tokens (<text:s/>, <text:tab/>,
// <text:line-break/>) form a plain-text stream. A find string is located in
// that stream; the replacement lands in the first covered token (re-encoded)
// and the remainder of the match is deleted from the following tokens. Find
// strings must stay within one paragraph (paragraph boundaries break the
// stream, mirroring how the extracted text separates them with newlines).

type Token =
  { kind: 'tag'; raw: string; pseudo?: string } | { kind: 'text'; raw: string; text: string }

export type FodtEdit = { find: string; replace: string }
export type FodtEditResult = { find: string; count: number }

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

export function encodeEntities(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function findMarkupEnd(xml: string, start: number): number {
  const terminated = (marker: string, from: number) => {
    const end = xml.indexOf(marker, from)
    if (end === -1) throw new Error('Flat ODT contains unterminated XML markup')
    return end + marker.length - 1
  }
  if (xml.startsWith('<!--', start)) return terminated('-->', start + 4)
  if (xml.startsWith('<![CDATA[', start)) return terminated(']]>', start + 9)
  if (xml.startsWith('<?', start)) return terminated('?>', start + 2)

  let quote: '"' | "'" | null = null
  let subsetDepth = 0
  for (let i = start + 1; i < xml.length; i++) {
    const char = xml[i]!
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (char === '[') {
      subsetDepth += 1
    } else if (char === ']' && subsetDepth > 0) {
      subsetDepth -= 1
    } else if (char === '>' && subsetDepth === 0) {
      return i
    }
  }
  throw new Error('Flat ODT contains an unterminated XML tag')
}

function openingTagName(raw: string): string | null {
  if (raw[1] === '/' || raw[1] === '!' || raw[1] === '?') return null
  let end = 1
  while (end < raw.length && !/[\s/>]/.test(raw[end]!)) end += 1
  return end > 1 ? raw.slice(1, end) : null
}

function isSelfClosingTag(raw: string): boolean {
  let end = raw.length - 2
  while (end >= 0 && /\s/.test(raw[end]!)) end -= 1
  return raw[end] === '/'
}

function quotedAttribute(raw: string, name: string): string | null {
  let from = 1
  for (;;) {
    const at = raw.indexOf(name, from)
    if (at === -1) return null
    const before = raw[at - 1]
    let cursor = at + name.length
    if (before && /[\w:.-]/.test(before)) {
      from = cursor
      continue
    }
    while (cursor < raw.length && /\s/.test(raw[cursor]!)) cursor += 1
    if (raw[cursor] !== '=') {
      from = cursor
      continue
    }
    cursor += 1
    while (cursor < raw.length && /\s/.test(raw[cursor]!)) cursor += 1
    const quote = raw[cursor]
    if (quote !== '"' && quote !== "'") return null
    const end = raw.indexOf(quote, cursor + 1)
    return end === -1 ? null : raw.slice(cursor + 1, end)
  }
}

function whitespacePseudo(raw: string): string | undefined {
  if (!isSelfClosingTag(raw)) return undefined
  switch (openingTagName(raw)) {
    case 'text:s': {
      const rawCount = quotedAttribute(raw, 'text:c')
      if (rawCount === null) return ' '
      if (!/^\d{1,5}$/.test(rawCount)) {
        throw new Error('Flat ODT contains an invalid text:s count')
      }
      const count = Number(rawCount)
      if (count < 1 || count > 10_000) {
        throw new Error('Flat ODT text:s count is outside the supported range')
      }
      return ' '.repeat(count)
    }
    case 'text:tab':
      return '\t'
    case 'text:line-break':
      return '\n'
    default:
      return undefined
  }
}

function tokenize(fodt: string): Token[] {
  const tokens: Token[] = []
  let offset = 0
  while (offset < fodt.length) {
    const tagStart = fodt.indexOf('<', offset)
    if (tagStart === -1) {
      const part = fodt.slice(offset)
      if (part) tokens.push({ kind: 'text', raw: part, text: decodeEntities(part) })
      break
    }
    if (tagStart > offset) {
      const part = fodt.slice(offset, tagStart)
      tokens.push({ kind: 'text', raw: part, text: decodeEntities(part) })
    }
    const tagEnd = findMarkupEnd(fodt, tagStart)
    const part = fodt.slice(tagStart, tagEnd + 1)
    const pseudo = whitespacePseudo(part)
    tokens.push(
      pseudo === undefined ? { kind: 'tag', raw: part } : { kind: 'tag', raw: part, pseudo },
    )
    offset = tagEnd + 1
  }
  return tokens
}

/**
 * Apply exact-match plain-text edits to a Flat ODT document. Every occurrence
 * of each `find` is replaced; the per-edit result carries the occurrence
 * count (0 = not found — the caller reports that back to the model).
 */
export function replaceTextInFodt(
  fodt: string,
  edits: FodtEdit[],
): { fodt: string; results: FodtEditResult[] } {
  let tokens = tokenize(fodt)
  const results: FodtEditResult[] = []

  for (const edit of edits) {
    if (!edit.find) {
      results.push({ find: edit.find, count: 0 })
      continue
    }

    // Replace one occurrence at a time, recomputing the stream after each so
    // offsets are always fresh; resume searching AFTER the replacement so a
    // replacement containing the find string can't loop forever.
    let count = 0
    let searchFrom = 0
    for (;;) {
      // Plain-text stream + map of stream offsets → tokens.
      let stream = ''
      const spans: { token: number; start: number; end: number }[] = []
      tokens.forEach((t, i) => {
        const text = t.kind === 'text' ? t.text : (t.pseudo ?? '')
        if (!text) return
        spans.push({ token: i, start: stream.length, end: stream.length + text.length })
        stream += text
      })

      const at = stream.indexOf(edit.find, searchFrom)
      if (at === -1) break
      const end = at + edit.find.length

      let placed = false
      for (const span of spans) {
        if (span.end <= at || span.start >= end) continue
        const t = tokens[span.token]!
        const text = t.kind === 'text' ? t.text : (t.pseudo ?? '')
        const cutStart = Math.max(0, at - span.start)
        const cutEnd = Math.min(text.length, end - span.start)
        const middle = placed ? '' : edit.replace
        const nextText =
          t.kind === 'text'
            ? text.slice(0, cutStart) + middle + text.slice(cutEnd)
            : // Whitespace pseudo-token covered by the match: drop the element,
              // keeping any replacement text in its place.
              middle
        tokens[span.token] = { kind: 'text', raw: encodeEntities(nextText), text: nextText }
        placed = true
      }

      count += 1
      searchFrom = at + edit.replace.length
      tokens = tokenize(tokens.map((t) => t.raw).join(''))
    }
    results.push({ find: edit.find, count })
  }

  return { fodt: tokens.map((t) => t.raw).join(''), results }
}
