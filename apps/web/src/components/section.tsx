'use client'

import { GeneratedValue } from '@/i18n/generated'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@beaconhs/ui'

/**
 * Accordion-style collapsible section — the legacy app's primary detail-page
 * layout pattern. Defaults to open; click the header to collapse.
 */
export function Section({
  title,
  subtitle,
  actions,
  defaultOpen = true,
  children,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Actions sit beside (not inside) the toggle button — consumers pass
          real links/buttons, and nested interactive elements are invalid HTML. */}
      <div className="flex items-center gap-3 pr-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
          aria-expanded={open}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              <ChevronDown
                size={16}
                className={cn(
                  'text-slate-400 transition-transform dark:text-slate-500',
                  open ? '' : '-rotate-90',
                )}
              />
              <GeneratedValue value={title} />
            </div>
            <GeneratedValue
              value={
                subtitle ? (
                  <div className="ml-6 text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={subtitle} />
                  </div>
                ) : null
              }
            />
          </div>
        </button>
        <GeneratedValue
          value={
            actions ? (
              <div className="shrink-0">
                <GeneratedValue value={actions} />
              </div>
            ) : null
          }
        />
      </div>
      <GeneratedValue
        value={
          open ? (
            <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
              <GeneratedValue value={children} />
            </div>
          ) : null
        }
      />
    </section>
  )
}
