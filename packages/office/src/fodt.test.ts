import { describe, expect, it } from 'vitest'
import { replaceTextInFodt } from './fodt'

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><office:document><office:body><office:text>${body}</office:text></office:body></office:document>`

describe('replaceTextInFodt', () => {
  it('replaces a match inside a single text run', () => {
    const fodt = wrap('<text:p>Wear a hard hat on site.</text:p>')
    const { fodt: out, results } = replaceTextInFodt(fodt, [
      { find: 'hard hat', replace: 'Type II hard hat' },
    ])
    expect(results).toEqual([{ find: 'hard hat', count: 1 }])
    expect(out).toContain('Wear a Type II hard hat on site.')
  })

  it('replaces a match spanning formatting runs and keeps the markup', () => {
    const fodt = wrap(
      '<text:p>Contact the <text:span text:style-name="T1">safety</text:span> office today.</text:p>',
    )
    const { fodt: out, results } = replaceTextInFodt(fodt, [
      { find: 'Contact the safety office', replace: 'Call the HSE coordinator' },
    ])
    expect(results[0]).toEqual({ find: 'Contact the safety office', count: 1 })
    expect(out).toContain('Call the HSE coordinator')
    // The emptied span stays structurally valid.
    expect(out).toContain('<text:span text:style-name="T1">')
    expect(out).toContain(' today.')
  })

  it('replaces every occurrence and reports the count', () => {
    const fodt = wrap('<text:p>site check</text:p><text:p>Another site check here.</text:p>')
    const { fodt: out, results } = replaceTextInFodt(fodt, [
      { find: 'site check', replace: 'site inspection' },
    ])
    expect(results[0]!.count).toBe(2)
    expect(out).not.toContain('site check')
    expect(out.match(/site inspection/g)).toHaveLength(2)
  })

  it('does not cross paragraph boundaries', () => {
    const fodt = wrap('<text:p>end of one</text:p><text:p>start of two</text:p>')
    const { results } = replaceTextInFodt(fodt, [{ find: 'one start', replace: 'x' }])
    expect(results[0]!.count).toBe(0)
  })

  it('reports 0 for text that is not in the document', () => {
    const fodt = wrap('<text:p>Hello world.</text:p>')
    const { fodt: out, results } = replaceTextInFodt(fodt, [{ find: 'missing', replace: 'x' }])
    expect(results[0]!.count).toBe(0)
    expect(out).toBe(fodt)
  })

  it('matches through <text:s/>, <text:tab/> and <text:line-break/> whitespace', () => {
    const fodt = wrap(
      '<text:p>Column A<text:tab/>Column B<text:s text:c="2"/>end<text:line-break/>next line</text:p>',
    )
    const { fodt: out, results } = replaceTextInFodt(fodt, [
      { find: 'Column A\tColumn B', replace: 'Merged header' },
      { find: 'end\nnext', replace: 'end continued' },
    ])
    expect(results).toEqual([
      { find: 'Column A\tColumn B', count: 1 },
      { find: 'end\nnext', count: 1 },
    ])
    expect(out).toContain('Merged header')
    expect(out).toContain('end continued')
    expect(out).not.toContain('<text:tab/>')
    expect(out).not.toContain('<text:line-break/>')
  })

  it('decodes entities in the source and re-encodes the replacement', () => {
    const fodt = wrap('<text:p>Safety &amp; Health rules</text:p>')
    const { fodt: out, results } = replaceTextInFodt(fodt, [
      { find: 'Safety & Health', replace: 'Health & Safety <priority>' },
    ])
    expect(results[0]!.count).toBe(1)
    expect(out).toContain('Health &amp; Safety &lt;priority&gt; rules')
  })

  it('does not loop when the replacement contains the find string', () => {
    const fodt = wrap('<text:p>rule rule</text:p>')
    const { fodt: out, results } = replaceTextInFodt(fodt, [
      { find: 'rule', replace: 'rule (updated)' },
    ])
    expect(results[0]!.count).toBe(2)
    expect(out).toContain('rule (updated) rule (updated)')
  })

  it('applies sequential edits where a later find matches earlier output', () => {
    const fodt = wrap('<text:p>alpha beta</text:p>')
    const { fodt: out, results } = replaceTextInFodt(fodt, [
      { find: 'alpha', replace: 'gamma' },
      { find: 'gamma beta', replace: 'delta' },
    ])
    expect(results.map((r) => r.count)).toEqual([1, 1])
    expect(out).toContain('<text:p>delta</text:p>')
  })

  it('ignores empty find strings', () => {
    const fodt = wrap('<text:p>text</text:p>')
    const { results } = replaceTextInFodt(fodt, [{ find: '', replace: 'x' }])
    expect(results[0]!.count).toBe(0)
  })
})
