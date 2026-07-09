import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  expandRepeatMarkers,
  htmlToPlainText,
  interpolate,
  renderEmail,
  renderTemplate,
  sanitizeEmailHtml,
} from './index'

describe('renderEmail — inline', () => {
  it('interpolates tokens, keeps line breaks as <br/>, and wraps the shell', () => {
    const r = renderEmail(
      {
        mode: 'inline',
        subject: 'Hello {{name}}',
        bodyTemplate: 'Hi {{name}},\nScore: {{score}}.',
      },
      { name: 'Sam', score: 88 },
    )
    expect(r.subject).toBe('Hello Sam')
    expect(r.text).toBe('Hi Sam,\nScore: 88.')
    expect(r.html).toContain('Hi Sam,<br/>Score: 88.')
    expect(r.html).toContain('BeaconHS')
  })
  it('reduces HTML-bearing values to plain text (no literal tags in emails)', () => {
    const r = renderEmail(
      { mode: 'inline', subject: 'Job {{scope}}', bodyTemplate: 'Scope: {{scope}}' },
      { scope: '<ul><li>lock out breaker</li><li>install cable</li></ul>' },
    )
    expect(r.subject).toBe('Job lock out breaker install cable')
    expect(r.text).toContain('lock out breaker')
    expect(r.text).not.toContain('<li>')
    expect(r.html).not.toContain('&lt;li&gt;')
  })
  it('drops "Label:" lines whose token resolved empty', () => {
    const r = renderEmail(
      {
        mode: 'inline',
        subject: 's',
        bodyTemplate: 'Summary: {{summary}}\nLocation: {{location}}\nNotes: {{notes}}',
      },
      { location: 'Bay 4' },
    )
    expect(r.text).toBe('Location: Bay 4')
  })
  it('appends the CTA to text and renders a button in html', () => {
    const r = renderEmail(
      {
        mode: 'inline',
        subject: 's',
        bodyTemplate: 'Body',
        cta: { url: 'https://app.example/incidents/1', label: 'View record' },
        brandName: 'Acme HSE',
      },
      {},
    )
    expect(r.text).toBe('Body\n\nView record: https://app.example/incidents/1')
    expect(r.html).toContain('href="https://app.example/incidents/1"')
    expect(r.html).toContain('View record')
    expect(r.html).toContain('Acme HSE')
  })
  it('falls back to "Notification" for an empty subject and escapes body HTML', () => {
    const r = renderEmail({ mode: 'inline', subject: '{{missing}}', bodyTemplate: 'a "b" & c' }, {})
    expect(r.subject).toBe('Notification')
    expect(r.html).toContain('a &quot;b&quot; &amp; c')
  })
})

describe('interpolate', () => {
  it('escapes substituted values when escapeHtml is set, not the template', () => {
    const out = interpolate('<p>{{x}}</p>', { x: 'A & "B"' }, { escapeHtml: true })
    expect(out).toBe('<p>A &amp; &quot;B&quot;</p>')
  })
  it('reduces HTML values to plain text before substitution', () => {
    expect(interpolate('{{x}}', { x: '<p>hi<br/>there</p>' })).toBe('hi\nthere')
    // script/style CONTENT is dropped, not rendered
    expect(interpolate('{{x}}', { x: '<script>alert(1)</script>' }, { escapeHtml: true })).toBe('')
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
      { ref: 'INC-1', name: 'Sam', note: 'A & B "ok"' },
    )
    expect(r.subject).toBe('Re: INC-1')
    expect(r.html).toBe('<h1>Hi Sam</h1><p>A &amp; B &quot;ok&quot;</p>')
    expect(r.text).toContain('Hi Sam')
    expect(r.text).toContain('A & B "ok"')
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
          { name: 'Fall from height', controls: 'Harness & line' },
          { name: 'Noise', controls: '<p>Plugs</p>' },
        ],
      },
      { escapeHtml: true },
    )
    expect(out).toBe(
      '<table>' +
        '<tr><td>1</td><td>Fall from height</td><td>Harness &amp; line</td></tr>' +
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
    // plain {{body}} reduces the HTML value to text — no literal tags leak
    expect(renderTemplate('{{body}}', { body: '<b>hi</b>' }, { escapeHtml: true })).toBe('hi')
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

describe('expandRepeatMarkers', () => {
  it('wraps a data-each row in {{#each}} and strips the marker', () => {
    const out = expandRepeatMarkers(
      '<table><tr><th>H</th></tr><tr data-each="hazards"><td>{{name}}</td></tr></table>',
    )
    expect(out).toBe(
      '<table><tr><th>H</th></tr>{{#each hazards}}<tr><td>{{name}}</td></tr>{{/each}}</table>',
    )
  })

  it('keeps other attributes on the row and supports data-if', () => {
    const out = expandRepeatMarkers('<tr class="r" data-if="photos" style="x"><td>a</td></tr>')
    expect(out).toBe('{{#if photos}}<tr class="r" style="x"><td>a</td></tr>{{/if}}')
  })

  it('end-to-end: expand then render produces real rows', () => {
    const tpl = expandRepeatMarkers(
      '<table><tr><th>Name</th></tr><tr data-each="sigs"><td>{{name}}</td></tr></table>',
    )
    const html = renderTemplate(
      tpl,
      { sigs: [{ name: 'Jane' }, { name: 'Bob' }] },
      { escapeHtml: true },
    )
    expect(html).toBe(
      '<table><tr><th>Name</th></tr><tr><td>Jane</td></tr><tr><td>Bob</td></tr></table>',
    )
  })

  // REGRESSION: the compile pipeline must sanitize BEFORE expanding. DOMPurify
  // foster-parents loose text out of <table> content, so sanitizing an
  // already-expanded template hoists the {{#each}}/{{#if}} braces after the
  // table and repeat rows never repeat. The markers are attributes (which
  // survive parsing) and are allow-listed in sanitizeEmailHtml.
  it('sanitize-then-expand keeps repeat blocks wrapping their <tr>', () => {
    const source =
      '<table><tr data-if="rows"><th>H</th></tr><tr data-each="rows"><td>{{name}}</td></tr></table>'
    const sanitized = sanitizeEmailHtml(source)
    expect(sanitized).toContain('data-each="rows"')
    expect(sanitized).toContain('data-if="rows"')
    const compiled = expandRepeatMarkers(sanitized)
    expect(compiled).toMatch(/\{\{#each rows\}\}<tr[\s\S]*?<\/tr>\{\{\/each\}\}/)
    const html = renderTemplate(compiled, { rows: [{ name: 'A' }, { name: 'B' }] })
    expect(html).toContain('<td>A</td>')
    expect(html).toContain('<td>B</td>')
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
