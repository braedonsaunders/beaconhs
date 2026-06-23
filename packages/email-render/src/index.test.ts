import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  htmlToPlainText,
  interpolate,
  renderEmail,
  renderTemplate,
  sanitizeEmailHtml,
} from './index'

// Reproduce the EXACT legacy inline behaviour from
// apps/web/.../apps/_lib/run-automations.ts so we can assert byte parity.
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
    {
      subject: 'Hello {{name}}',
      body: 'Hi {{name}},\nYour score is {{score}}.',
      values: { name: 'Sam', score: 88 },
    },
    { subject: '', body: 'No subject case', values: {} },
    {
      subject: 'Site {{site}}',
      body: 'Danger: <b>{{hazard}}</b> & "stuff"',
      values: { site: 'Tower', hazard: '<script>' },
    },
    { subject: '{{missing}}', body: 'token {{missing}} gone', values: {} },
  ]
  for (const c of cases) {
    it(`matches legacy for subject="${c.subject}"`, () => {
      const got = renderEmail(
        { mode: 'inline', subject: c.subject, bodyTemplate: c.body },
        c.values,
      )
      expect(got).toEqual(legacyInline(c.subject, c.body, c.values))
    })
  }
})

describe('interpolate', () => {
  it('escapes substituted values when escapeHtml is set, not the template', () => {
    const out = interpolate(
      '<p>{{x}}</p>',
      { x: '<script>alert(1)</script>' },
      { escapeHtml: true },
    )
    expect(out).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })
  it('leaves template + value raw without escapeHtml', () => {
    expect(interpolate('{{x}}', { x: '<b>' })).toBe('<b>')
  })
})

describe('renderEmail — template/design', () => {
  it('interpolates escaped values into trusted HTML and derives text', () => {
    const r = renderEmail(
      {
        mode: 'template',
        subjectTemplate: 'Re: {{ref}}',
        compiledHtml: '<h1>Hi {{name}}</h1><p>{{note}}</p>',
      },
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

describe('renderTemplate — blocks', () => {
  it('matches interpolate for scalar-only templates (back-compat)', () => {
    const tpl = '<h1>Hi {{name}}</h1><p>{{note}}</p>'
    const values = { name: 'Sam', note: 'A & B <ok>' }
    expect(renderTemplate(tpl, values, { escapeHtml: true })).toBe(
      interpolate(tpl, values, { escapeHtml: true }),
    )
  })

  it('renders an #each table over a collection, escaping item fields', () => {
    const tpl =
      '<table>{{#each hazards}}<tr><td>{{@number}}</td><td>{{name}}</td><td>{{controls}}</td></tr>{{/each}}</table>'
    const out = renderTemplate(
      tpl,
      {
        hazards: [
          { name: 'Fall <ht>', controls: 'Harness & line' },
          { name: 'Noise', controls: 'Plugs' },
        ],
      },
      { escapeHtml: true },
    )
    expect(out).toBe(
      '<table>' +
        '<tr><td>1</td><td>Fall &lt;ht&gt;</td><td>Harness &amp; line</td></tr>' +
        '<tr><td>2</td><td>Noise</td><td>Plugs</td></tr>' +
        '</table>',
    )
  })

  it('renders nothing for a missing or empty collection', () => {
    expect(renderTemplate('A{{#each x}}row{{/each}}B', {})).toBe('AB')
    expect(renderTemplate('A{{#each x}}row{{/each}}B', { x: [] })).toBe('AB')
  })

  it('honours #if / else with empty-array falsiness', () => {
    const tpl = '{{#if ppe}}<h2>PPE</h2>{{else}}<p>No PPE</p>{{/if}}'
    expect(renderTemplate(tpl, { ppe: [{ name: 'Gloves' }] })).toBe('<h2>PPE</h2>')
    expect(renderTemplate(tpl, { ppe: [] })).toBe('<p>No PPE</p>')
    expect(renderTemplate(tpl, {})).toBe('<p>No PPE</p>')
  })

  it('supports {{this}} for primitive items and {{{raw}}} for trusted HTML', () => {
    expect(renderTemplate('{{#each tags}}[{{this}}]{{/each}}', { tags: ['a', 'b'] })).toBe('[a][b]')
    expect(renderTemplate('{{{body}}}', { body: '<b>hi</b>' }, { escapeHtml: true })).toBe(
      '<b>hi</b>',
    )
    expect(renderTemplate('{{body}}', { body: '<b>hi</b>' }, { escapeHtml: true })).toBe(
      '&lt;b&gt;hi&lt;/b&gt;',
    )
  })

  it('resolves nested #each, outer-scope tokens (via the scope chain) + dotted paths', () => {
    // No `../` — an inner block still sees outer tokens ({{ref}}) through the
    // scope chain, and {{this.kids}} drills into the current item.
    const tpl = '{{#each rows}}{{ref}}:{{name}}({{#each this.kids}}{{label}};{{/each}}){{/each}}'
    const out = renderTemplate(tpl, {
      ref: 'R1',
      rows: [{ name: 'P', kids: [{ label: 'k1' }, { label: 'k2' }] }],
    })
    expect(out).toBe('R1:P(k1;k2;)')
  })

  it('renderEmail template mode renders an each table end-to-end', () => {
    const r = renderEmail(
      {
        mode: 'template',
        subjectTemplate: 'Assessment {{reference}}',
        compiledHtml:
          '<h1>{{reference}}</h1><table>{{#each hazards}}<tr><td>{{name}}</td></tr>{{/each}}</table>',
      },
      { reference: 'HAZ-1', hazards: [{ name: 'Fall' }, { name: 'Fire' }] },
    )
    expect(r.subject).toBe('Assessment HAZ-1')
    expect(r.html).toBe('<h1>HAZ-1</h1><table><tr><td>Fall</td></tr><tr><td>Fire</td></tr></table>')
    expect(r.text).toContain('Fall')
    expect(r.text).toContain('Fire')
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
    expect(htmlToPlainText('<p>Hello&nbsp;<b>world</b></p><p>A &amp; B</p>')).toBe(
      'Hello world\nA & B',
    )
  })
})

describe('escapeHtml', () => {
  it('escapes the html-significant chars', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })
})
