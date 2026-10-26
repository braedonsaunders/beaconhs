import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { journalBodyDocumentHtml } from './journals'

describe('journal PDF body', () => {
  it('keeps the entry paragraphs and lists', () => {
    const html = journalBodyDocumentHtml(
      '<p>Met the crew.</p><ol><li><p>Bolts missing.</p></li><li><p>Retorque.</p></li></ol>',
      'Met the crew.',
    )
    expect(html).toBe(
      '<p>Met the crew.</p><ol><li><p>Bolts missing.</p></li><li><p>Retorque.</p></li></ol>',
    )
  })

  it('removes unsafe markup before the template merges it raw', () => {
    const html = journalBodyDocumentHtml(
      '<p onclick="x()">Safe</p><script>alert(1)</script><img src="https://evil.test/a.png">',
      null,
    )
    expect(html).toBe('<p>Safe</p>')
  })

  it('uses migrated HTML stored in the text column', () => {
    expect(journalBodyDocumentHtml('', '<ul><li>Legacy</li></ul>')).toBe('<ul><li>Legacy</li></ul>')
  })

  it('turns a plain-text body into escaped paragraphs and line breaks', () => {
    expect(journalBodyDocumentHtml(null, 'First & second\nline\n\nNext')).toBe(
      '<p>First &amp; second<br>line</p><p>Next</p>',
    )
    expect(journalBodyDocumentHtml(null, '  ')).toBe('')
  })
})
