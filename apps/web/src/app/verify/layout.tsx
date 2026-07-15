import { GeneratedValue } from '@/i18n/generated'
// Public verify pages render straight into <body>, which the root layout locks
// with overflow-hidden (the authenticated shell scrolls its own panes). Give
// them their own scroll container so long content — a full training
// transcript, a tall certificate — actually scrolls.
export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <GeneratedValue value={children} />
    </div>
  )
}
