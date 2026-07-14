import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml } from '@beaconhs/email-render'
import { sanitizeDocumentHtml } from './sanitize'

describe('sanitizeDocumentHtml inline styles', () => {
  it('does not mutate the separate transactional-email sanitizer policy', () => {
    const email =
      '<table class="email-shell" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px;background-color:#fff">Hi</td></tr></table>'
    const before = sanitizeEmailHtml(email)

    sanitizeDocumentHtml('<p style="position:fixed;inset:0">Document</p>')

    const after = sanitizeEmailHtml(email)
    expect(after).toBe(before)
    expect(after).toContain('class="email-shell"')
    expect(after).toContain('border-collapse:collapse')
    expect(after).toContain('padding:24px')
  })

  it('removes overlay, executable, remote-resource, and legacy binding CSS', () => {
    const clean = sanitizeDocumentHtml(`
      <div style="position:fixed;inset:0;z-index:999999;display:block;transform:scale(2);background:url(https://tracker.example/pixel);width:expression(alert(1));behavior:url(xss.htc);-moz-binding:url(evil.xml#xss);color:#0f766e;text-align:center">
        Safe text
      </div>
    `)

    expect(clean).not.toMatch(/position|inset|z-index|display|transform|background|url|expression/i)
    expect(clean).not.toMatch(/behavior|binding|tracker\.example/i)
    // A dangerous function invalidates the whole style attribute instead of
    // trying to recover around an obfuscated declaration.
    expect(clean).not.toContain('style=')
    expect(clean).toContain('Safe text')
  })

  it('removes tracking and escaped CSS even when placed in an allowed property', () => {
    expect(
      sanitizeDocumentHtml(
        '<p style="background-color:url(https://tracker.example/pixel);color:#334155">Text</p>',
      ),
    ).toBe('<p>Text</p>')
    expect(
      sanitizeDocumentHtml('<p style="background-color:u\\72l(javascript:alert(1))">Text</p>'),
    ).toBe('<p>Text</p>')
  })

  it('preserves the bounded typographic styles authored by the rich-text editors', () => {
    const clean = sanitizeDocumentHtml(
      '<p style="text-align:center;line-height:1.5"><span style="color:#0f766e;background-color:rgb(254, 240, 138);font-family:Arial, sans-serif;font-size:14pt;font-style:italic;font-weight:700;letter-spacing:0.2px;text-decoration:underline;text-transform:uppercase">Formatted</span></p>',
    )

    expect(clean).toContain('text-align: center')
    expect(clean).toContain('line-height: 1.5')
    expect(clean).toContain('color: #0f766e')
    expect(clean).toContain('background-color: rgb(254, 240, 138)')
    expect(clean).toContain('font-family: Arial, sans-serif')
    expect(clean).toContain('font-size: 14pt')
    expect(clean).toContain('font-style: italic')
    expect(clean).toContain('font-weight: 700')
    expect(clean).toContain('letter-spacing: 0.2px')
    expect(clean).toContain('text-decoration: underline')
    expect(clean).toContain('text-transform: uppercase')
  })

  it('keeps bounded TipTap table sizing but strips layout sizing from ordinary blocks', () => {
    const clean = sanitizeDocumentHtml(
      '<div style="width:100%;min-width:500px">Block</div><table style="width:100%;min-width:320px"><colgroup><col style="width:120px"></colgroup><tbody><tr><td>A</td></tr></tbody></table>',
    )

    expect(clean).toContain('<div>Block</div>')
    expect(clean).toContain('table style="width: 100%; min-width: 320px"')
    expect(clean).toContain('col style="width: 120px"')
  })

  it('drops extreme values instead of allowing visual denial-of-service', () => {
    const clean = sanitizeDocumentHtml(
      '<p style="font-size:9999px;line-height:1000;letter-spacing:500px;color:#334155">Text</p>',
    )

    expect(clean).toBe('<p style="color: #334155">Text</p>')
  })

  it('prevents utility classes and arbitrary data attributes from recreating overlays', () => {
    const clean = sanitizeDocumentHtml(
      '<div class="fixed inset-0 z-[9999] text-teal-700 underline" data-walkthrough="submit">Text</div>',
    )

    expect(clean).toBe('<div class="text-teal-700 underline">Text</div>')
  })

  it('preserves and validates the data attributes emitted by TipTap extensions', () => {
    const clean = sanitizeDocumentHtml(
      '<mark data-color="#fef08a" style="background-color:#fef08a;color:inherit">Marked</mark><mark data-color="red;position:fixed">Unsafe</mark><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>',
    )

    expect(clean).toContain('data-color="#fef08a"')
    expect(clean).not.toContain('red;position')
    expect(clean).toContain(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">',
    )
  })

  it('allows only static document elements and never loads embedded resources', () => {
    const clean = sanitizeDocumentHtml(`
      <form action="/admin"><input name="role" value="owner"><button>Submit</button></form>
      <img src="https://tracker.example/pixel" width="999999" height="999999" alt="Tracking">
      <video src="https://tracker.example/video" autoplay controls>Video text</video>
      <audio src="https://tracker.example/audio" autoplay>Audio text</audio>
      <marquee behavior="scroll">Legacy text</marquee>
      <font size="99">Font text</font>
    `)

    expect(clean).not.toMatch(/<(?:form|input|button|img|video|audio|marquee|font)\b/i)
    expect(clean).not.toMatch(/tracker\.example|autoplay|width=|height=|action=/i)
    expect(clean).toContain('Submit')
    expect(clean).toContain('Legacy text')
    expect(clean).toContain('Font text')
  })

  it('bounds table spans and rejects named link browsing contexts', () => {
    const clean = sanitizeDocumentHtml(
      '<table width="999999" height="999999"><tbody><tr><th scope="col" colspan="2">H</th><td colspan="999" rowspan="0">A</td></tr></tbody></table><a href="https://example.com" target="admin" rel="opener">Named</a><a href="https://example.com" target="_blank">Blank</a>',
    )

    expect(clean).not.toMatch(/width=|height=|colspan="999"|rowspan=|target="admin"|rel="opener"/)
    expect(clean).toContain('<th scope="col" colspan="2">H</th>')
    expect(clean).toContain('target="_blank" rel="noopener noreferrer"')
  })

  it('permits only stable application attachment images in the explicit image profile', () => {
    const capability = 'A'.repeat(43)
    const appImage = `/api/attachments/00000000-0000-4000-8000-000000000001?cap=${capability}`
    const clean = sanitizeDocumentHtml(
      `<img src="${appImage}" alt="Diagram" class="lesson-img"><img src="https://tracker.example/pixel"><img src="//tracker.example/pixel"><img src="data:image/png;base64,AA==">`,
      { allowApplicationImages: true },
    )

    expect(clean).toBe(`<img src="${appImage}" alt="Diagram" class="lesson-img">`)
    expect(sanitizeDocumentHtml(`<img src="${appImage}" alt="Diagram">`)).toBe('')
  })

  it('keeps only non-credentialed HTTPS, contact, and same-origin document links', () => {
    const clean = sanitizeDocumentHtml(
      '<a href="https://example.com/path">Web</a><a href="mailto:safety@example.com">Mail</a><a href="tel:+15551234567">Phone</a><a href="/help">Help</a><a href="//tracker.example/path">Protocol relative</a><a href="http://example.com">Plain HTTP</a><a href="https://user:pass@example.com">Credentials</a>',
    )

    expect(clean).toContain('href="https://example.com/path"')
    expect(clean).toContain('href="mailto:safety@example.com"')
    expect(clean).toContain('href="tel:+15551234567"')
    expect(clean).toContain('href="/help"')
    expect(clean).not.toMatch(/href="(?:\/\/|http:|https:\/\/user:pass)/)
  })
})
