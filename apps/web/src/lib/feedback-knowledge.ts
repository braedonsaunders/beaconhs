import type { KnowledgeSource } from '@braedonsaunders/appkit-feedback'
import type { RequestContext } from '@beaconhs/tenant'
import { manualArticleForUser, searchManualArticles } from '@/lib/manual/registry'

export function createFeedbackKnowledge(ctx: RequestContext): KnowledgeSource {
  return {
    async search(query) {
      return searchManualArticles(ctx, query)
        .slice(0, 8)
        .map(({ article, excerpt }) => ({
          id: article.slug,
          title: article.title,
          url: `/help/${article.slug}`,
          excerpt: excerpt || article.summary,
        }))
    },
    async read(id) {
      const article = manualArticleForUser(ctx, id)
      if (!article) return null
      return {
        title: article.title,
        url: `/help/${article.slug}`,
        body: article.body,
      }
    },
  }
}
