import { Skeleton } from '@beaconhs/ui'
import { useGeneratedTranslations } from '@/i18n/generated'
import { ListPageLayout } from '@/components/page-layout'

// In-shell loading fallback for routes without their own skeleton. The brand
// splash belongs to the first document load only (root layout + root
// loading.tsx); navigating, searching, or filtering inside the app shows this
// quiet page-shaped placeholder instead.
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <ListPageLayout
      header={
        <>
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-9 w-32" />
          </div>
          <Skeleton className="h-9 w-full max-w-md" />
        </>
      }
    >
      <div
        role="status"
        aria-busy="true"
        aria-label={tGenerated('m_17c4f4b56b341b')}
        className="space-y-3"
      >
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </ListPageLayout>
  )
}
