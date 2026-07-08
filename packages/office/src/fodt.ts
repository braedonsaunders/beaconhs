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
  | { kind: 'tag'; raw: string; pseudo?: string }
  | { kind: 'text'; raw: string; text: string }

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

function tokenize(fodt: string): Token[] {
  const parts = fodt.split(/(<[^>]*>)/)
  const tokens: Token[] = []
  for (const part of parts) {
    if (part === '') continue
    if (part.startsWith('<')) {
      // Whitespace elements participate in the plain-text stream.
      if (/^<text:s\b[^>]*\/>$/.test(part)) {
        const m = part.match(/text:c="(\d+)"/)
        tokens.push({ kind: 'tag', raw: part, pseudo: ' '.repeat(m ? Number(m[1]) : 1) })
      } else if (/^<text:tab\b[^>]*\/>$/.test(part)) {
        tokens.push({ kind: 'tag', raw: part, pseudo: '\t' })
      } else if (/^<text:line-break\b[^>]*\/>$/.test(part)) {
        tokens.push({ kind: 'tag', raw: part, pseudo: '\n' })
      } else {
        tokens.push({ kind: 'tag', raw: part })
      }
    } else {
      tokens.push({ kind: 'text', raw: part, text: decodeEntities(part) })
    }
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
