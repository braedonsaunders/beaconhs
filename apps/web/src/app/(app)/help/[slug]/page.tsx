import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// A single user-guide article. Permission-aware: unknown slugs and articles
// the user isn't allowed to see both 404. Articles with a matching guided tour
// offer a "Show me" launch button.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PlayCircle } from 'lucide-react'
import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { ManualMarkdown } from '@/components/manual-markdown'
import { manualArticleForUser } from '@/lib/manual/registry'
import { resolveWalkthroughs } from '@/lib/walkthroughs/service'

export const dynamic = 'force-dynamic'

// Article slug → guided tour that demonstrates it live.
const ARTICLE_TOURS: Record<string, string> = {
  'getting-started': 'welcome',
  'help-and-tours': 'welcome',
  journals: 'daily-journal',
  'hazard-assessments': 'hazard-assessment',
  inspections: 'site-inspection',
  incidents: 'report-incident',
  'vehicle-log': 'vehicle-log',
  ppe: 'ppe-inspection',
  training: 'my-training',
  'user-access': 'manage-user-access',
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const ctx = await requireRequestContext()
  const { slug } = await params
  const article = manualArticleForUser(ctx, slug)
  if (!article) notFound()

  // Offer the matching tour only when this user may actually launch it.
  const tourId = ARTICLE_TOURS[article.slug]
  let tour: { id: string; startPath: string; title: string } | null = null
  if (tourId) {
    const { visible } = await ctx.db((tx) => resolveWalkthroughs(ctx, tx))
    const match = visible.find((v) => v.walkthrough.id === tourId)
    if (match) {
      tour = {
        id: match.walkthrough.id,
        startPath: match.walkthrough.startPath,
        title: match.walkthrough.title,
      }
    }
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          back={{ href: '/help', label: 'User Guide' }}
          title={tGeneratedValue(article.title)}
          description={tGeneratedValue(article.summary)}
          actions={
            tour ? (
              <Link
                href={`${tour.startPath}?walkthrough=${tour.id}` as never}
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800 transition-colors hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-200 dark:hover:bg-teal-950"
              >
                <PlayCircle size={15} /> <GeneratedText id="m_1ae02d764a25ee" />
              </Link>
            ) : undefined
          }
        />
        <ManualMarkdown>{article.body}</ManualMarkdown>
      </div>
    </PageContainer>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { slug } = await params
  return { title: tGenerated('m_141b9ae9ba712a', { value0: slug.replace(/-/g, ' ') }) }
}
