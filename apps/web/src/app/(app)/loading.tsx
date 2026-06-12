import { RouteLoadingMark } from '@/components/route-loading-mark'

// In-shell loading fallback for routes without their own skeleton: the
// lighthouse draws itself in, the lamp ignites, and the beacon sweeps while
// the page streams in. Rapid back-to-back navigations skip the draw and show
// the pulsing beacon instead (cooldown lives in RouteLoadingMark).
export default function Loading() {
  return (
    <div className="grid h-full min-h-[60vh] place-items-center">
      <RouteLoadingMark className="h-12 w-auto opacity-90" />
    </div>
  )
}
