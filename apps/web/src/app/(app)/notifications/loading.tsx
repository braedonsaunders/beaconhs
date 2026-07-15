import { useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
import { Skeleton } from '@beaconhs/ui'

/**
 * Streamed loading state for /notifications. Mirrors the Outlook-style inbox
 * chrome — folder rail, message list, and reading pane — so the layout doesn't
 * jump when the real inbox streams in.
 */
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <div
      role="status"
      aria-label={tGenerated('m_0d206f1590514f')}
      aria-busy="true"
      className="flex h-full min-h-0 bg-slate-50 dark:bg-slate-950"
    >
      {/* Folder rail — desktop only, like the real rail. */}
      <div className="hidden w-64 shrink-0 flex-col gap-2 border-r border-slate-200 p-3 lg:flex dark:border-slate-800">
        <GeneratedValue
          value={Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        />
      </div>

      {/* Message list */}
      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white lg:w-96 lg:flex-none xl:w-[28rem] dark:border-slate-800 dark:bg-slate-900">
        <div className="shrink-0 space-y-2.5 border-b border-slate-200 px-3 py-3 sm:px-4 dark:border-slate-800">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
        <div className="flex-1 overflow-hidden">
          <GeneratedValue
            value={Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-slate-100 px-3 py-3 sm:px-4 dark:border-slate-800/70"
              >
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          />
        </div>
      </section>

      {/* Reading pane — desktop only. */}
      <div className="hidden min-w-0 flex-1 items-center justify-center lg:flex">
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
    </div>
  )
}
