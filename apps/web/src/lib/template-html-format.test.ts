import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'
import { expandRepeatMarkers, renderTemplate } from '@beaconhs/email-render'
import { formatTemplateHtml } from './template-html-format'

/** What prints: the rendered DOM with whitespace-only text between blocks ignored. */
function printed(html: string): string {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`)
  const doc = dom.window.document
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */)
  const blank: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    const display = parent ? dom.window.getComputedStyle(parent).display : 'block'
    if (!(node as Text).data.trim() && display !== 'inline') blank.push(node as Text)
  }
  // Whitespace directly inside a block, or between two block children, is not rendered.
  for (const node of blank) {
    const prev = node.previousSibling as Element | null
    const next = node.nextSibling as Element | null
    const inlineSibling = (el: Element | null) =>
      !!el && (el.nodeType === 3 || dom.window.getComputedStyle(el).display === 'inline')
    if (!inlineSibling(prev) || !inlineSibling(next)) node.remove()
  }
  const out = doc.body.innerHTML
  dom.window.close()
  return out
}

describe('formatTemplateHtml', () => {
  it('puts blocks on their own indented lines', () => {
    expect(
      formatTemplateHtml(
        '<div><h1>Title</h1><table><tr><td>{{a}}</td><td><span>{{b}}</span> km</td></tr></table></div>',
      ),
    ).toBe(
      [
        '<div>',
        '  <h1>Title</h1>',
        '  <table>',
        '    <tr>',
        '      <td>{{a}}</td>',
        '      <td><span>{{b}}</span> km</td>',
        '    </tr>',
        '  </table>',
        '</div>',
      ].join('\n'),
    )
  })

  it('never touches inline content or whitespace-preserving elements', () => {
    const inline =
      '<p>Hello <strong>{{name}}</strong>, <span>{{a}}</span><span>{{b}}</span><br>x</p>'
    expect(formatTemplateHtml(inline)).toBe(inline)
    const pre = '<div style="white-space:pre-wrap"><div>a</div>\n  <div>b</div></div>'
    expect(formatTemplateHtml(pre)).toBe(pre)
    const byRule =
      '<style>#keep{white-space:pre-wrap}</style><div id="keep"><p>a</p> <p>b</p></div>'
    expect(formatTemplateHtml(byRule)).toContain('<div id="keep"><p>a</p> <p>b</p></div>')
    const chips =
      '<style>#c1{display:inline-block}#c2{display:inline-block}</style><div id="c1">A</div> <div id="c2">B</div>'
    expect(formatTemplateHtml(chips)).toContain('<div id="c1">A</div> <div id="c2">B</div>')
  })

  it('puts style rules one per line and handlebars control tokens on their own lines', () => {
    expect(
      formatTemplateHtml(
        '<style>#a{color:red;}#b{font-weight:700;}</style><table><tr data-each="rows">{{#if x}}<td>{{y}}</td>{{else}}<td>-</td>{{/if}}</tr></table>',
      ),
    ).toBe(
      [
        '<style>',
        '  #a{color:red;}',
        '  #b{font-weight:700;}',
        '</style>',
        '<table>',
        '  <tr data-each="rows">',
        '    {{#if x}}',
        '    <td>{{y}}</td>',
        '    {{else}}',
        '    <td>-</td>',
        '    {{/if}}',
        '  </tr>',
        '</table>',
      ].join('\n'),
    )
  })

  it('keeps attribute values with > and quotes intact and is idempotent', () => {
    const html = '<div title="a > b" data-x=\'{{c}}\'><img src="{{url}}" alt=""><p>t</p></div>'
    const once = formatTemplateHtml(html)
    expect(once).toContain('<div title="a > b" data-x=\'{{c}}\'>')
    expect(formatTemplateHtml(once)).toBe(once)
  })

  for (const seed of MODULE_PDF_TEMPLATE_SEEDS) {
    it(`prints ${seed.key} exactly as before`, () => {
      const formatted = formatTemplateHtml(seed.html)
      expect(formatTemplateHtml(formatted)).toBe(formatted)
      const data = { title: 'T', reference: 'R-1', entries: [{ day: 1, is_weekend: true }] }
      expect(printed(renderTemplate(expandRepeatMarkers(formatted), data))).toBe(
        printed(renderTemplate(expandRepeatMarkers(seed.html), data)),
      )
    })
  }
})
