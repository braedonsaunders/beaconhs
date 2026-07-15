import { GeneratedValue } from '@/i18n/generated'
import { Skeleton } from '@beaconhs/ui'
import { DetailPageLayout } from './page-layout'

/**
 * Full-height loading placeholder for entity detail ([id]) pages. Mirrors the
 * DetailPageLayout chrome — back-link, title row with status chips, actions, a
 * subtab strip, and content cards — so clicking into a record shows a
 * detail-shaped skeleton instead of inheriting the parent list's table/card
 * skeleton (Next.js loading.tsx cascades into nested segments).
 */
export function DetailSkeleton() {
  return (
    <DetailPageLayout
      header={
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" /> {/* back link */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-7 w-56 sm:w-72" /> {/* title */}
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        </div>
      }
      subtabs={
        <div className="flex flex-wrap gap-2">
          <GeneratedValue
            value={Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24" />
            ))}
          />
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Skeleton className="h-4 w-40" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3.5 w-full max-w-2xl" />
            <Skeleton className="h-3.5 w-full max-w-xl" />
            <Skeleton className="h-3.5 w-3/4 max-w-lg" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <GeneratedValue
            value={Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <Skeleton className="h-4 w-32" />
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-5/6" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              </div>
            ))}
          />
        </div>
      </div>
    </DetailPageLayout>
  )
}
