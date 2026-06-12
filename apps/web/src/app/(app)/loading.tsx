import { LogoMark } from '@/components/brand-logo'

// In-shell loading fallback for routes without their own skeleton: the beacon
// sweeps while the page streams in.
export default function Loading() {
  return (
    <div className="grid h-full min-h-[60vh] place-items-center">
      <LogoMark animated className="h-12 w-auto opacity-90" />
    </div>
  )
}
