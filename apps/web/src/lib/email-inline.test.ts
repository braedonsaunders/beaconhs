import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { inlineEmailCss } from './email-inline'

describe('inlineEmailCss', () => {
  it('inlines builder CSS onto matching elements for mail clients', () => {
    const rendered = inlineEmailCss(`
      <style>
        .card { color: #123456; padding: 12px; }
        .card strong { font-weight: 700; }
      </style>
      <div class="card"><strong>Safety first</strong></div>
    `)

    expect(rendered).not.toContain('<style>')
    expect(rendered).toMatch(/<div class="card" style="[^"]*color: #123456[^"]*padding: 12px/)
    expect(rendered).toMatch(/<strong style="font-weight: 700;?">Safety first<\/strong>/)
  })

  it('leaves markup without an authored style block byte-for-byte unchanged', () => {
    const html = '<div class="card">{{employee_name}}</div>'
    expect(inlineEmailCss(html)).toBe(html)
  })

  it('keeps responsive media rules while inlining their base declarations', () => {
    const rendered = inlineEmailCss(`
      <style>
        .column { width: 50%; }
        @media (max-width: 600px) { .column { width: 100%; } }
      </style>
      <div class="column">Content</div>
    `)

    expect(rendered).toContain('style="width: 50%;"')
    expect(rendered).toContain('@media (max-width: 600px)')
    expect(rendered).toContain('.column')
    expect(rendered).toContain('width: 100%')
  })
})
