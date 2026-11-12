// Pretty-print template HTML for the PDF designer's HTML tab.
//
// The designer saves a document as one long line, which is unreadable as code.
// This lays it out one block per line with indentation — WITHOUT changing what
// prints. It only ever adds or removes whitespace where browsers ignore it:
// between two block-level tags (table structure, divs, paragraphs, headings…).
// Text, inline elements ({{values}}, <span>, <strong>, <br>, <img>) and
// anything inside a whitespace-preserving element (<pre>, <textarea>, or a
// `white-space:pre*` style) are emitted exactly as written. <style> rules are
// put one per line. Handlebars control tokens ({{#if}}, {{else}}, {{/each}})
// standing alone between blocks get their own line. Formatting formatted
// output returns it unchanged.

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'col',
  'colgroup',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'li',
  'link',
  'main',
  'meta',
  'nav',
  'ol',
  'p',
  'section',
  'style',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'ul',
])
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
/** Elements whose content is raw text, not markup. */
const RAW_TEXT_TAGS = new Set(['style', 'script', 'textarea', 'title'])
const PRESERVE_TAGS = new Set(['pre', 'textarea', 'script'])
const INDENT = '  '

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'comment'; text: string }
  | {
      kind: 'open' | 'close' | 'void'
      text: string
      name: string
      id: string | null
      style: string
    }
  | { kind: 'raw'; text: string; name: string }

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match ? (match[2] ?? match[3] ?? match[4] ?? '') : null
}

/** End of the tag starting at `start` (index after its `>`), honouring quoted attribute values. */
function tagEnd(html: string, start: number): number {
  let quote: string | null = null
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i + 1
    }
  }
  return html.length
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let text = ''
  const flushText = () => {
    if (text) tokens.push({ kind: 'text', text })
    text = ''
  }
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      flushText()
      const end = html.indexOf('-->', i + 4)
      const stop = end === -1 ? html.length : end + 3
      tokens.push({ kind: 'comment', text: html.slice(i, stop) })
      i = stop
      continue
    }
    const tagStart = html[i] === '<' && /[A-Za-z/!]/.test(html[i + 1] ?? '')
    if (!tagStart) {
      text += html[i]
      i++
      continue
    }
    flushText()
    const end = tagEnd(html, i)
    const tag = html.slice(i, end)
    i = end
    const closing = tag.startsWith('</')
    const name = (/^<\/?\s*([A-Za-z!][\w:-]*)/.exec(tag)?.[1] ?? '').toLowerCase()
    if (closing) {
      tokens.push({ kind: 'close', text: tag, name, id: null, style: '' })
      continue
    }
    const isVoid = VOID_TAGS.has(name) || name.startsWith('!') || /\/\s*>$/.test(tag)
    tokens.push({
      kind: isVoid ? 'void' : 'open',
      text: tag,
      name,
      id: attribute(tag, 'id'),
      style: attribute(tag, 'style') ?? '',
    })
    if (!isVoid && RAW_TEXT_TAGS.has(name)) {
      const close = new RegExp(`</\\s*${name}\\s*>`, 'i')
      const rest = html.slice(i)
      const at = rest.search(close)
      const content = at === -1 ? rest : rest.slice(0, at)
      if (content) tokens.push({ kind: 'raw', text: content, name })
      i += content.length
    }
  }
  flushText()
  return tokens
}

/** Ids whose CSS rules change how whitespace around or inside them renders. */
function cssIdTraits(tokens: Token[]): { inline: Set<string>; preserve: Set<string> } {
  const inline = new Set<string>()
  const preserve = new Set<string>()
  for (const token of tokens) {
    if (token.kind !== 'raw' || token.name !== 'style') continue
    for (const rule of token.text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = rule[2] ?? ''
      const ids = [...(rule[1] ?? '').matchAll(/#([\w-]+)/g)].map((m) => m[1]!)
      if (/display\s*:\s*inline/i.test(body)) ids.forEach((id) => inline.add(id))
      if (/white-space\s*:\s*(pre|break-spaces)/i.test(body)) ids.forEach((id) => preserve.add(id))
    }
  }
  return { inline, preserve }
}

const HANDLEBARS_CONTROL = /^(\s*\{\{~?\s*(#|\/|\^|else\b)[^{}]*\}\})+\s*$/

function formatCss(css: string, depth: number): string[] {
  return css
    .replace(/\s+/g, ' ')
    .replace(/\}\s*/g, '}\n')
    .replace(/\{\s*/g, '{')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => INDENT.repeat(depth) + line)
}

export function formatTemplateHtml(html: string): string {
  const tokens = tokenize(html)
  const traits = cssIdTraits(tokens)
  const stack: { name: string; block: boolean; preserve: boolean }[] = []
  let out = ''
  let pending = ''
  let lastWasBlock = true
  let depth = 0

  const preserving = () => stack.some((entry) => entry.preserve)
  const newline = (level: number) => {
    out = out.replace(/[ \t]+$/, '')
    out += (out ? '\n' : '') + INDENT.repeat(Math.max(0, level))
  }
  /** Put the text before a block boundary on the page, breaking lines where it is safe. */
  const boundary = (level: number, keep = preserving(), textLevel = level) => {
    if (keep || !lastWasBlock) {
      out += pending
    } else if (!pending.trim()) {
      newline(level)
    } else if (HANDLEBARS_CONTROL.test(pending)) {
      newline(textLevel)
      out += pending.trim()
      newline(level)
    } else {
      out += pending
    }
    pending = ''
  }
  const isBlock = (token: { name: string; id: string | null; style: string }) =>
    (BLOCK_TAGS.has(token.name) || token.name.startsWith('!')) &&
    !/display\s*:\s*inline/i.test(token.style) &&
    !(token.id && traits.inline.has(token.id))

  for (const token of tokens) {
    switch (token.kind) {
      case 'text':
        pending += token.text
        break
      case 'comment':
        boundary(depth)
        out += token.text
        lastWasBlock = true
        break
      case 'raw':
        out += pending
        pending = ''
        if (token.name === 'style' && !preserving()) {
          const lines = formatCss(token.text, depth)
          if (lines.length) out += `\n${lines.join('\n')}`
          lastWasBlock = true
        } else {
          out += token.text
          lastWasBlock = false
        }
        break
      case 'void': {
        const block = isBlock(token)
        if (block) boundary(depth)
        else {
          out += pending
          pending = ''
        }
        out += token.text
        lastWasBlock = block
        break
      }
      case 'open': {
        const block = isBlock(token)
        if (block) boundary(depth)
        else {
          out += pending
          pending = ''
        }
        out += token.text
        stack.push({
          name: token.name,
          block,
          preserve:
            PRESERVE_TAGS.has(token.name) ||
            /white-space\s*:\s*(pre|break-spaces)/i.test(token.style) ||
            (!!token.id && traits.preserve.has(token.id)),
        })
        if (block) depth++
        lastWasBlock = block
        break
      }
      case 'close': {
        const at = stack.map((entry) => entry.name).lastIndexOf(token.name)
        const entry = at === -1 ? null : stack[at]!
        const block = entry ? entry.block : BLOCK_TAGS.has(token.name)
        // Whitespace before a preserving element's own close tag is its content.
        const keep = preserving()
        const contentLevel = depth
        if (entry) {
          // Close anything left open inside it (lenient, like the HTML parser).
          for (const dropped of stack.splice(at)) if (dropped.block) depth--
        }
        if (block) boundary(depth, keep, contentLevel)
        else {
          out += pending
          pending = ''
        }
        out += token.text
        lastWasBlock = block
        break
      }
    }
  }
  out += pending
  return out.trim()
}
