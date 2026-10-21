import { Skeleton } from '@beaconhs/ui'
import { PRODUCT_NAME } from '@/lib/brand'

// The root boundary can suspend on the first visit to another route too.
// Keep it provider-independent and never restart the tab's startup animation.
export default function Loading() {
  return (
    <div role="progressbar" aria-label={PRODUCT_NAME} className="space-y-6 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    </div>
  )
}
