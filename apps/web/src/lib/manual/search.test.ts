import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import { searchManualArticles } from './registry'

// The guide is searched with questions, not keywords. "how do I move My PPE to
// my dashboard?" used to rank on "how"/"do"/"my"/"to" — which appear in nearly
// every article — while "dashboard?" matched nothing at all because the
// question mark was never stripped.

// A super-admin context so permission gating never hides an article here; the
// gating itself is covered by the registry's visibility helpers.
const ctx = {
  tenantId: '00000000-0000-4000-8000-000000000000',
  locale: 'en',
  isSuperAdmin: true,
  permissions: ['*'],
} as unknown as RequestContext

const slugs = (query: string) => searchManualArticles(ctx, query).map((hit) => hit.article.slug)

describe('manual search', () => {
  it('answers the question that prompted this: moving My PPE onto the dashboard', () => {
    const results = searchManualArticles(ctx, 'how do I move My PPE to my dashboard?')
    expect(results.length).toBeGreaterThan(0)
    const top = results[0]!
    expect(top.article.slug).toBe('getting-started')
    // and it points at the section that actually explains it
    expect(top.section).toBe('Changing what is on your dashboard')
  })

  it('ignores trailing punctuation', () => {
    expect(slugs('dashboard?')).toEqual(slugs('dashboard'))
    expect(slugs('hazard assessment!')).toEqual(slugs('hazard assessment'))
  })

  it('ranks an article matching every meaningful term above one matching a subset', () => {
    const results = searchManualArticles(ctx, 'add widget dashboard')
    expect(results[0]!.article.slug).toBe('getting-started')
  })

  it('does not let question scaffolding decide the ranking', () => {
    // These differ only in the stopwords, so they must rank the same.
    expect(slugs('how do I add a widget')).toEqual(slugs('add widget'))
  })

  it('still returns partial matches rather than nothing', () => {
    // No article covers both, but "incident" alone should still find articles.
    const results = searchManualArticles(ctx, 'incident zzzznotaword')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((hit) => hit.article.slug === 'incidents')).toBe(true)
  })

  it('returns every visible article for an empty or all-stopword query', () => {
    expect(searchManualArticles(ctx, '').length).toBeGreaterThan(10)
    expect(searchManualArticles(ctx, '   ').length).toBeGreaterThan(10)
  })

  it('finds an article by a keyword that never appears in its body', () => {
    // JSHA/FLHA are keywords on the hazard assessment article.
    expect(slugs('FLHA')[0]).toBe('hazard-assessments')
  })

  it('carries an excerpt for a body match but not for a keyword-only hit', () => {
    // "Widget library" is real body text on the dashboard section.
    const [body] = searchManualArticles(ctx, 'widget library')
    expect(body?.excerpt.length ?? 0).toBeGreaterThan(0)

    // "tailgate" is a keyword on the hazard assessment article and appears
    // nowhere in its prose, so there is no honest excerpt to show.
    const [keywordOnly] = searchManualArticles(ctx, 'tailgate')
    expect(keywordOnly?.article.slug).toBe('hazard-assessments')
    expect(keywordOnly?.excerpt).toBe('')
  })
})
