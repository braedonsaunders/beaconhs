// Assembles every manual article and provides the permission-aware accessors
// used by /help, the AI assistant's user-guide tools, and search.

import type { RequestContext } from '@beaconhs/tenant'
import { can } from '@beaconhs/tenant'
import { translateSystemCopy } from '@beaconhs/i18n/messages'
import { GETTING_STARTED_ARTICLES } from './content/getting-started'
import { FRONTLINE_ARTICLES } from './content/frontline'
import { KNOWLEDGE_ASSETS_ARTICLES } from './content/knowledge-assets'
import { OVERSIGHT_ADMIN_ARTICLES } from './content/oversight-admin'
import { MANUAL_GROUP_ORDER, type ManualArticle, type ManualGroup } from './types'

const MANUAL_ARTICLES: ManualArticle[] = [
  ...GETTING_STARTED_ARTICLES,
  ...FRONTLINE_ARTICLES,
  ...KNOWLEDGE_ASSETS_ARTICLES,
  ...OVERSIGHT_ADMIN_ARTICLES,
]

const BY_SLUG = new Map(MANUAL_ARTICLES.map((a) => [a.slug, a]))

function localizeArticle(ctx: RequestContext, article: ManualArticle): ManualArticle {
  if (ctx.locale === 'en') return article
  return {
    ...article,
    title: translateSystemCopy(ctx.locale, article.title),
    summary: translateSystemCopy(ctx.locale, article.summary),
    body: translateSystemCopy(ctx.locale, article.body),
  }
}

/** Can this user see this article? Mirrors the nav registry's gating. */
function canSeeArticle(ctx: RequestContext, article: ManualArticle): boolean {
  if (article.requiredPermission && !can(ctx, article.requiredPermission)) return false
  if (article.requiredAnyPermission && !article.requiredAnyPermission.some((p) => can(ctx, p)))
    return false
  return true
}

/** Every article the user may read, in registry order. */
function visibleManualArticles(ctx: RequestContext): ManualArticle[] {
  return MANUAL_ARTICLES.filter((a) => canSeeArticle(ctx, a)).map((article) =>
    localizeArticle(ctx, article),
  )
}

/** A single article, or null when unknown / not permitted. */
export function manualArticleForUser(ctx: RequestContext, slug: string): ManualArticle | null {
  const a = BY_SLUG.get(slug)
  if (!a || !canSeeArticle(ctx, a)) return null
  return localizeArticle(ctx, a)
}

/** Visible articles grouped in MANUAL_GROUP_ORDER, empty groups dropped. */
export function groupedManualArticles(
  ctx: RequestContext,
): { group: ManualGroup; articles: ManualArticle[] }[] {
  const visible = visibleManualArticles(ctx)
  return MANUAL_GROUP_ORDER.map((group) => ({
    group,
    articles: visible.filter((a) => a.group === group),
  })).filter((g) => g.articles.length > 0)
}

type ManualSearchHit = {
  article: ManualArticle
  /** A short plain-text excerpt around the best body match (empty when the
   *  match was title/keywords only). */
  excerpt: string
  /** The `## heading` the excerpt came from, so a hit can say where to look. */
  section?: string
}

// People search the guide by asking a question, not by naming a feature:
// "how do I move My PPE to my dashboard?". Scoring every whitespace token
// equally over whole article bodies made that unrankable — "how", "do", "my"
// and "to" appear in nearly every article, so noise buried the one real term,
// and "dashboard?" matched nothing because the question mark was never
// stripped. Normalise, drop the question scaffolding, and rank on the terms
// that carry meaning.

const SEARCH_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'can',
  'do',
  'does',
  'for',
  'from',
  'get',
  'give',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'set',
  'should',
  'that',
  'the',
  'their',
  'them',
  'there',
  'they',
  'this',
  'to',
  'up',
  'use',
  'want',
  'what',
  'when',
  'where',
  'which',
  'why',
  'will',
  'with',
  'you',
  'your',
])

/** Lowercase, strip punctuation, split. Keeps intra-word hyphens and apostrophes. */
function searchTerms(query: string): { all: string[]; meaningful: string[] } {
  const all = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/^[-']+|[-']+$/g, ''))
    .filter(Boolean)
  const meaningful = all.filter((term) => term.length > 1 && !SEARCH_STOPWORDS.has(term))
  // An all-stopword query ("how do I") still has to search something.
  return { all, meaningful: meaningful.length > 0 ? meaningful : all }
}

type ArticleSection = { heading: string; body: string; offset: number }

/** Split an article body on its `## headings` so a hit can name its section. */
function articleSections(body: string): ArticleSection[] {
  const sections: ArticleSection[] = []
  const re = /^##\s+(.+)$/gm
  let match = re.exec(body)
  if (!match) return [{ heading: '', body, offset: 0 }]
  if (match.index > 0) sections.push({ heading: '', body: body.slice(0, match.index), offset: 0 })
  while (match) {
    const heading = match[1]!.trim()
    const contentStart = match.index + match[0].length
    const next = re.exec(body)
    sections.push({
      heading,
      body: body.slice(contentStart, next ? next.index : body.length),
      offset: contentStart,
    })
    match = next
  }
  return sections
}

/**
 * Search the guide. Articles matching EVERY meaningful term rank first; if
 * nothing matches them all we fall back to partial matches rather than telling
 * someone their question has no answer.
 */
export function searchManualArticles(ctx: RequestContext, query: string): ManualSearchHit[] {
  const articles = visibleManualArticles(ctx)
  const { meaningful } = searchTerms(query)
  if (meaningful.length === 0) return articles.map((article) => ({ article, excerpt: '' }))

  const scored: { hit: ManualSearchHit; score: number; matched: number }[] = []
  for (const article of articles) {
    const title = article.title.toLowerCase()
    const summary = article.summary.toLowerCase()
    const keywords = article.keywords.join(' ').toLowerCase()
    const sections = articleSections(article.body)

    let score = 0
    let matched = 0
    let best: { section: ArticleSection; index: number; hits: number } | null = null
    // Distinct query terms found in each section. A section mentioning several
    // of them is the answer; the same words scattered across an article are
    // usually just an article that happens to talk about the subject.
    const sectionTerms = new Map<ArticleSection, Set<string>>()

    for (const term of meaningful) {
      let hitThisTerm = false
      if (title.includes(term)) {
        score += 12
        hitThisTerm = true
      }
      if (keywords.includes(term)) {
        score += 8
        hitThisTerm = true
      }
      if (summary.includes(term)) {
        score += 5
        hitThisTerm = true
      }
      for (const section of sections) {
        // A heading naming the term is what someone is actually looking for.
        if (section.heading.toLowerCase().includes(term)) {
          score += 11
          hitThisTerm = true
        }
        const index = section.body.toLowerCase().indexOf(term)
        if (index < 0) continue
        score += 2
        hitThisTerm = true
        const terms = sectionTerms.get(section) ?? new Set<string>()
        terms.add(term)
        sectionTerms.set(section, terms)
        if (!best || terms.size > best.hits) best = { section, index, hits: terms.size }
      }
      if (hitThisTerm) matched += 1
    }

    if (matched === 0) continue
    // Reward covering the whole question over mentioning one word a lot.
    score += matched * 15
    // …and reward one section covering several terms over an article that
    // mentions them in unrelated places. "How do I move My PPE to my
    // dashboard?" should land on the dashboard section that says how, not on
    // the PPE article that merely owns the word "PPE" in its title.
    const bestSectionTerms = best?.hits ?? 0
    if (bestSectionTerms > 1) score += (bestSectionTerms - 1) * 14
    const section = best?.section
    const excerpt = section ? bodyExcerpt(article.body, section.offset + (best?.index ?? 0)) : ''
    scored.push({
      hit: { article, excerpt, section: section?.heading || undefined },
      score,
      matched,
    })
  }

  const complete = scored.filter((entry) => entry.matched === meaningful.length)
  const ranked = complete.length > 0 ? complete : scored
  ranked.sort((a, b) => b.score - a.score)
  return ranked.map((entry) => entry.hit)
}

function bodyExcerpt(body: string, idx: number): string {
  if (idx < 0) return ''
  const start = Math.max(0, idx - 60)
  const end = Math.min(body.length, idx + 120)
  const raw = body.slice(start, end)
  // Strip markdown decorations so the excerpt reads as plain text.
  const plain = raw
    .replace(/[#>*_`]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return `${start > 0 ? '…' : ''}${plain}${end < body.length ? '…' : ''}`
}
