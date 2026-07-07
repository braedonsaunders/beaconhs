// Assembles every manual article and provides the permission-aware accessors
// used by /help, the AI assistant's user-guide tools, and search.

import type { RequestContext } from '@beaconhs/tenant'
import { can } from '@beaconhs/tenant'
import { GETTING_STARTED_ARTICLES } from './content/getting-started'
import { FRONTLINE_ARTICLES } from './content/frontline'
import { KNOWLEDGE_ASSETS_ARTICLES } from './content/knowledge-assets'
import { OVERSIGHT_ADMIN_ARTICLES } from './content/oversight-admin'
import { MANUAL_GROUP_ORDER, type ManualArticle, type ManualGroup } from './types'

export const MANUAL_ARTICLES: ManualArticle[] = [
  ...GETTING_STARTED_ARTICLES,
  ...FRONTLINE_ARTICLES,
  ...KNOWLEDGE_ASSETS_ARTICLES,
  ...OVERSIGHT_ADMIN_ARTICLES,
]

const BY_SLUG = new Map(MANUAL_ARTICLES.map((a) => [a.slug, a]))

/** Can this user see this article? Mirrors the nav registry's gating. */
export function canSeeArticle(ctx: RequestContext, article: ManualArticle): boolean {
  if (article.requiredPermission && !can(ctx, article.requiredPermission)) return false
  if (article.requiredAnyPermission && !article.requiredAnyPermission.some((p) => can(ctx, p)))
    return false
  return true
}

/** Every article the user may read, in registry order. */
export function visibleManualArticles(ctx: RequestContext): ManualArticle[] {
  return MANUAL_ARTICLES.filter((a) => canSeeArticle(ctx, a))
}

/** A single article, or null when unknown / not permitted. */
export function manualArticleForUser(ctx: RequestContext, slug: string): ManualArticle | null {
  const a = BY_SLUG.get(slug)
  if (!a || !canSeeArticle(ctx, a)) return null
  return a
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

export type ManualSearchHit = {
  article: ManualArticle
  /** A short plain-text excerpt around the first body match (empty when the
   *  match was title/keywords only). */
  excerpt: string
}

/** Case-insensitive search over title, summary, keywords and body. */
export function searchManualArticles(ctx: RequestContext, query: string): ManualSearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return visibleManualArticles(ctx).map((article) => ({ article, excerpt: '' }))
  const terms = q.split(/\s+/).filter(Boolean)
  const hits: { hit: ManualSearchHit; score: number }[] = []
  for (const article of visibleManualArticles(ctx)) {
    const title = article.title.toLowerCase()
    const summary = article.summary.toLowerCase()
    const keywords = article.keywords.join(' ').toLowerCase()
    const body = article.body.toLowerCase()
    let score = 0
    let firstBodyIdx = -1
    for (const t of terms) {
      if (title.includes(t)) score += 10
      if (keywords.includes(t)) score += 6
      if (summary.includes(t)) score += 4
      const idx = body.indexOf(t)
      if (idx >= 0) {
        score += 2
        if (firstBodyIdx < 0 || idx < firstBodyIdx) firstBodyIdx = idx
      }
    }
    if (score === 0) continue
    hits.push({ hit: { article, excerpt: bodyExcerpt(article.body, firstBodyIdx) }, score })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.map((h) => h.hit)
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
