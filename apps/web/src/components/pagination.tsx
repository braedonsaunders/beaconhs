import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { mergeHref } from '@/lib/list-params'

export function Pagination({
  basePath,
  currentParams,
  total,
  page,
  perPage,
  pageParamKey = 'page',
}: {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  total: number
  page: number
  perPage: number
  /** URL param that carries the page number. Sub-tables pass a prefixed key. */
  pageParamKey?: string
}) {
  const tGenerated = useGeneratedTranslations()
  const pageCount = Math.max(1, Math.ceil(total / perPage))
  const isOutOfRange = total > 0 && page > pageCount
  const from = total === 0 ? 0 : (page - 1) * perPage + 1
  const to = Math.min(total, page * perPage)

  const prevHref = mergeHref(basePath, currentParams, {
    [pageParamKey]: page > 1 ? page - 1 : 1,
  })
  const nextHref = mergeHref(basePath, currentParams, {
    [pageParamKey]: Math.min(pageCount, page + 1),
  })
  const lastPageHref = mergeHref(basePath, currentParams, {
    [pageParamKey]: pageCount,
  })

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
      <span>
        <GeneratedValue
          value={
            isOutOfRange ? (
              <>
                <GeneratedText id="m_1f07a454b7b05b" />{' '}
                <GeneratedValue value={page.toLocaleString()} />{' '}
                <GeneratedText id="m_02054615ee6bc7" />
              </>
            ) : total === 0 ? (
              <>
                <GeneratedText id="m_0c726da8b78d42" />
              </>
            ) : (
              <>
                <GeneratedText id="m_01d77276c22eb1" />
                <GeneratedValue value={' '} />
                <strong className="font-medium text-slate-900 dark:text-slate-100">
                  <GeneratedValue value={from.toLocaleString()} />
                </strong>
                <GeneratedValue value={'–'} />
                <strong className="font-medium text-slate-900 dark:text-slate-100">
                  <GeneratedValue value={to.toLocaleString()} />
                </strong>
                <GeneratedValue value={' '} />
                <GeneratedText id="m_00e704d1194796" />
                <GeneratedValue value={' '} />
                <strong className="font-medium text-slate-900 dark:text-slate-100">
                  <GeneratedValue value={total.toLocaleString()} />
                </strong>
              </>
            )
          }
        />
      </span>
      <GeneratedValue
        value={
          isOutOfRange ? (
            <PageButton
              href={lastPageHref}
              aria-label={tGenerated('m_01ff8553409a3f', { value0: pageCount })}
            >
              <ChevronLeft size={14} />
              <GeneratedText id="m_110511a95ab416" />{' '}
              <GeneratedValue value={pageCount.toLocaleString()} />
            </PageButton>
          ) : pageCount > 1 ? (
            <div className="flex items-center gap-1">
              <PageButton
                href={prevHref}
                disabled={page <= 1}
                aria-label={tGenerated('m_1a91739487f373')}
              >
                <ChevronLeft size={14} />
                <GeneratedText id="m_15a155fcc8eaa3" />
              </PageButton>
              <span className="px-2 text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_1f07a454b7b05b" /> <GeneratedValue value={page} />{' '}
                <GeneratedText id="m_00e704d1194796" /> <GeneratedValue value={pageCount} />
              </span>
              <PageButton
                href={nextHref}
                disabled={page >= pageCount}
                aria-label={tGenerated('m_08e164e340384f')}
              >
                <GeneratedText id="m_08b5fa148b2af7" />
                <ChevronRight size={14} />
              </PageButton>
            </div>
          ) : null
        }
      />
    </div>
  )
}

function PageButton({
  href,
  disabled,
  children,
  ...rest
}: {
  href: string
  disabled?: boolean
  children: React.ReactNode
} & React.HTMLAttributes<HTMLAnchorElement>) {
  if (disabled) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500"
        {...(rest as object)}
      >
        <GeneratedValue value={children} />
      </span>
    )
  }
  return (
    <Link
      href={href as any}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/60"
      {...(rest as object)}
    >
      <GeneratedValue value={children} />
    </Link>
  )
}
