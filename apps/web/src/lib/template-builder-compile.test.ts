import { describe, expect, it } from 'vitest'
import { compileBuilderHtml } from './template-builder-compile'

describe('template builder compilation', () => {
  it('returns one sanitized source for both editing and compiled delivery', () => {
    const result = compileBuilderHtml(
      '<table><tr data-each="items" onclick="alert(1)"><td>{{name}}</td></tr></table><script>alert(2)</script>',
    )

    expect(result.errors).toEqual([])
    expect(result.sanitizedSource).toContain('data-each="items"')
    expect(result.sanitizedSource).not.toContain('onclick')
    expect(result.sanitizedSource).not.toContain('<script')
    expect(result.html).toContain('{{#each items}}')
    expect(result.html).toContain('{{/each}}')
    expect(result.html).not.toContain('data-each')
  })

  it('does not return a partially usable source when compilation fails', () => {
    const result = compileBuilderHtml('x'.repeat(1_000_001))
    expect(result.html).toBe('')
    expect(result.sanitizedSource).toBe('')
    expect(result.errors).toHaveLength(1)
  })
})
