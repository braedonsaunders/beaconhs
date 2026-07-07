// The built-in user guide: plain-language, permission-aware help articles plus
// launchable guided tours. Article visibility mirrors the nav registry's gates,
// so people only see help for features they can actually open.

import Link from 'next/link'
import { ArrowUpRight, CheckCircle2, PlayCircle } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { NavIcon } from '@/components/sidebar-nav'
import { groupedManualArticles, searchManualArticles } from '@/lib/manual/registry'
import { resolveWalkthroughs } from '@/lib/walkthroughs/service'
import { pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'User Guide' }

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const query = (pickString(sp.q) ?? '').trim()

  const [tours] = await Promise.all([ctx.db((tx) => resolveWalkthroughs(ctx, tx))])
  const hits = query ? searchManualArticles(ctx, query) : null
  const groups = query ? [] : groupedManualArticles(ctx)

  return (
    <PageContainer>
      <div className="space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              User Guide
            </h1>
            <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              Plain-language help for everything in BeaconHS. You can also ask the Assistant how to
              do something — it reads this guide.
            </p>
          </div>
          <SearchInput placeholder="Search the guide…" />
        </header>

        {/* Guided tours — step-by-step overlays that highlight the real UI. */}
        {!query && tours.visible.length > 0 ? (
          <section className="space-y-2.5">
            <h2 className="px-0.5 text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
              Guided tours
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {tours.visible.map(({ walkthrough, done }) => (
                <Link
                  key={walkthrough.id}
                  href={`${walkthrough.startPath}?walkthrough=${walkthrough.id}` as never}
                  className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-teal-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100 dark:bg-teal-950/50 dark:text-teal-300 dark:ring-teal-900">
                    <PlayCircle size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {walkthrough.title}
                      </h3>
                      {done ? (
                        <CheckCircle2
                          size={14}
                          aria-label="Completed"
                          className="shrink-0 text-teal-600 dark:text-teal-400"
                        />
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {walkthrough.description}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Search results */}
        {hits ? (
          hits.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              No articles match “{query}”. Try a different word, or ask the Assistant.
            </p>
          ) : (
            <section className="space-y-2.5">
              <h2 className="px-0.5 text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                {hits.length} article{hits.length === 1 ? '' : 's'}
              </h2>
              <div className="space-y-2">
                {hits.map(({ article, excerpt }) => (
                  <Link
                    key={article.slug}
                    href={`/help/${article.slug}` as never}
                    className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-teal-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                      <NavIcon iconKey={article.iconKey} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                        {article.title}
                      </h3>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                        {excerpt || article.summary}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )
        ) : (
          groups.map(({ group, articles }) => (
            <section key={group} className="space-y-2.5">
              <h2 className="px-0.5 text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                {group}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {articles.map((article) => (
                  <Link
                    key={article.slug}
                    href={`/help/${article.slug}` as never}
                    title={article.summary}
                    className={cn(
                      'group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900',
                      'hover:border-teal-300 dark:hover:border-teal-700',
                    )}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                      <NavIcon iconKey={article.iconKey} size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {article.title}
                      </h3>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {article.summary}
                      </p>
                    </div>
                    <ArrowUpRight
                      size={15}
                      aria-hidden
                      className="shrink-0 text-slate-300 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-teal-600 group-hover:opacity-100 dark:text-slate-600 dark:group-hover:text-teal-300"
                    />
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </PageContainer>
  )
}
