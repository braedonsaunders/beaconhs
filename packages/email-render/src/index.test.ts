import { describe, expect, it } from 'vitest'
import { escapeHtml, htmlToPlainText, interpolate, renderEmail, sanitizeEmailHtml } from './index'

// Reproduce the EXACT legacy inline behaviour from
// apps/web/.../forms/_lib/run-automations.ts so we can assert byte parity.
function legacyInline(subjectTpl: string, bodyTpl: string, values: Record<string, unknown>) {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const intp = (tpl: string) =>
    tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
      const v = values[k]
      return v == null ? '' : String(v)
    })
  const subject = intp(subjectTpl) || 'Notification'
  const body = intp(bodyTpl)
  return {
    subject,
    text: body,
    html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:680px;white-space:pre-wrap;">${esc(
      body,
    )}</div>`,
  }
}

describe('renderEmail — inline parity', () => {
  const cases: Array<{ subject: string; body: string; values: Record<string, unknown> }> = [
    { subject: 'Hello {{name}}', body: 'Hi {{name}},\nYour score is {{score}}.', values: { name: 'Sam', score: 88 } },
    { subject: '', body: 'No subject case', values: {} },
    { subject: 'Site {{site}}', body: 'Danger: <b>{{hazard}}</b> & "stuff"', values: { site: 'Tower', hazard: '<script>' } },
    { subject: '{{missing}}', body: 'token {{missing}} gone', values: {} },
  ]
  for (const c of cases) {
    it(`matches legacy for subject="${c.subject}"`, () => {
      const got = renderEmail({ mode: 'inline', subject: c.subject, bodyTemplate: c.body }, c.values)
      expect(got).toEqual(legacyInline(c.subject, c.body, c.values))
    })
  }
})

describe('interpolate', () => {
  it('escapes substituted values when escapeHtml is set, not the template', () => {
    const out = interpolate('<p>{{x}}</p>', { x: '<script>alert(1)</script>' }, { escapeHtml: true })
    expect(out).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })
  it('leaves template + value raw without escapeHtml', () => {
    expect(interpolate('{{x}}', { x: '<b>' })).toBe('<b>')
  })
})

describe('renderEmail — template/design', () => {
  it('interpolates escaped values into trusted HTML and derives text', () => {
    const r = renderEmail(
      { mode: 'template', subjectTemplate: 'Re: {{ref}}', compiledHtml: '<h1>Hi {{name}}</h1><p>{{note}}</p>' },
      { ref: 'INC-1', name: 'Sam', note: 'A & B <ok>' },
    )
    expect(r.subject).toBe('Re: INC-1')
    expect(r.html).toBe('<h1>Hi Sam</h1><p>A &amp; B &lt;ok&gt;</p>')
    expect(r.text).toContain('Hi Sam')
    expect(r.text).toContain('A & B <ok>')
  })
  it('falls back to "Notification" for an empty subject', () => {
    const r = renderEmail({ mode: 'design', subjectTemplate: '', compiledHtml: '<p>x</p>' }, {})
    expect(r.subject).toBe('Notification')
  })
})

describe('sanitizeEmailHtml', () => {
  it('keeps email tags/attrs but strips script', () => {
    const out = sanitizeEmailHtml(
      '<html><head><style>.x{color:red}</style></head><body><table bgcolor="#fff"><tr><td>Hi</td></tr></table><script>alert(1)</script></body></html>',
    )
    expect(out).toContain('<style>')
    expect(out).toContain('bgcolor')
    expect(out).toContain('<table')
    expect(out).not.toContain('<script>')
  })
})

describe('htmlToPlainText', () => {
  it('strips tags + decodes entities', () => {
    expect(htmlToPlainText('<p>Hello&nbsp;<b>world</b></p><p>A &amp; B</p>')).toBe('Hello world\nA & B')
  })
})

describe('escapeHtml', () => {
  it('escapes the html-significant chars', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })
})
