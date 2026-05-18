import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { mergeHref } from '@/lib/list-params'

export function Pagination({
  basePath,
  currentParams,
  total,
  page,
  perPage,
}: {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  total: number
  page: number
  perPage: number
}) {
  const pageCount = Math.max(1, Math.ceil(total / perPage))
  const from = total === 0 ? 0 : (page - 1) * perPage + 1
  const to = Math.min(total, page * perPage)

  const prevHref = mergeHref(basePath, currentParams, { page: page > 1 ? page - 1 : 1 })
  const nextHref = mergeHref(basePath, currentParams, { page: Math.min(pageCount, page + 1) })

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-600">
      <span>
        {total === 0 ? (
          <>No results</>
        ) : (
          <>
            Showing <strong className="font-medium text-slate-900">{from.toLocaleString()}</strong>
            {'–'}
            <strong className="font-medium text-slate-900">{to.toLocaleString()}</strong> of{' '}
            <strong className="font-medium text-slate-900">{total.toLocaleString()}</strong>
          </>
        )}
      </span>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <PageButton href={prevHref} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft size={14} />
            Prev
          </PageButton>
          <span className="px-2 text-slate-500">
            Page {page} of {pageCount}
          </span>
          <PageButton href={nextHref} disabled={page >= pageCount} aria-label="Next page">
            Next
            <ChevronRight size={14} />
          </PageButton>
        </div>
      ) : null}
    </div>
  )
}

function PageButton({
  href,
  disabled,
  children,
  ...rest
}: { href: string; disabled?: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLAnchorElement>) {
  if (disabled) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400"
        {...(rest as object)}
      >
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href as any}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
      {...(rest as object)}
    >
      {children}
    </Link>
  )
}
