import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildDocxFromHtml } from './html-docx'

const html = Buffer.from(`<!doctype html><html><body>
  <h1>Energy Control</h1>
  <p>Use <strong>lockout</strong> and <em>verify</em> <a href="https://example.com/safe?a=1&amp;b=2">the procedure</a>.</p>
  <ol><li>Shut down</li><li>Isolate<ul><li>Electrical</li></ul></li></ol>
  <table><thead><tr><th>Source</th><th>State</th></tr></thead><tbody><tr><td>Main</td><td>Off</td></tr></tbody></table>
  <pre>meter = 0\nproceed()</pre>
</body></html>`)

describe('buildDocxFromHtml', () => {
  it('builds deterministic, editable WordprocessingML with rich structure', async () => {
    const first = await buildDocxFromHtml(html)
    const second = await buildDocxFromHtml(html)
    expect(first.equals(second)).toBe(true)
    expect([...first.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])

    const zip = await JSZip.loadAsync(first)
    const entries = Object.values(zip.files)
    expect(entries.filter((entry) => entry.dir)).toHaveLength(0)
    expect(new Set(entries.map((entry) => entry.date.getTime())).size).toBe(1)
    const document = await zip.file('word/document.xml')!.async('string')
    const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string')
    const numbering = await zip.file('word/numbering.xml')!.async('string')
    expect(document).toContain('<w:pStyle w:val="Heading1"/>')
    expect(document).toContain('<w:b/>')
    expect(document).toContain('<w:i/>')
    expect(document).toContain('<w:hyperlink r:id="rId3"')
    expect(document).toContain('<w:numId w:val="2"/>')
    expect(document).toContain('<w:numId w:val="1"/>')
    expect(document).toContain('<w:tbl>')
    expect(document).toContain('Courier New')
    expect(relationships).toContain('https://example.com/safe?a=1&amp;b=2')
    expect(numbering).toContain('<w:abstractNum w:abstractNumId="0">')
  })

  it('produces a valid editable blank document for empty input', async () => {
    const output = await buildDocxFromHtml(Buffer.from(''))
    const zip = await JSZip.loadAsync(output)
    expect(await zip.file('word/document.xml')!.async('string')).toContain('<w:body><w:p/>')
  })
})
