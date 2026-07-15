import { describe, expect, it } from 'vitest'
import { htmlToSnippet, htmlToText } from './text'

describe('htmlToText', () => {
  it('preserves meaningful block breaks and decodes entities once', () => {
    expect(htmlToText('<p>One &amp; two</p><p>Three<br>Four&nbsp;</p>')).toBe(
      'One & two\nThree\nFour',
    )
    expect(htmlToText('&amp;lt;literal&amp;gt;')).toBe('&lt;literal&gt;')
  })

  it('removes executable tags and never reconstructs nested markup', () => {
    const text = htmlToText(
      '<p>Safe</p><script>alert(1)</script><scr<script>ipt>hidden</scr</script>ipt>',
    )
    expect(text).toContain('Safe')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('<script>')
  })

  it('builds a bounded single-line snippet from sanitized text', () => {
    expect(htmlToSnippet('<p>Alpha</p><p>Beta Gamma</p>', 12)).toBe('Alpha Beta…')
  })
})
