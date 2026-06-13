import { LogoMark } from '@/components/brand-logo'

// In-shell loading fallback for routes without their own skeleton: the
// lighthouse draws itself in, the lamp ignites, and the beacon sweeps while
// the page streams in.
export default function Loading() {
  return (
    <div className="grid h-full min-h-[60vh] place-items-center">
      <LogoMark draw className="h-12 w-auto opacity-90" />
    </div>
  )
}
