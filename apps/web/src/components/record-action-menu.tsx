'use client'

import { type ReactNode, useCallback, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, Popover } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

/** One record-level action surface, with destructive actions always last. */
export function RecordActionMenu({
  children,
  destructive,
}: {
  children: ReactNode
  destructive?: ReactNode
}) {
  const t = useGeneratedValueTranslations()
  const [open, setOpen] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const focusFirstAction = useCallback(
    (node: HTMLDivElement | null) => {
      if (open)
        node
          ?.querySelector<HTMLElement>('a[href], button:not(:disabled), select:not(:disabled)')
          ?.focus()
    },
    [open],
  )

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      keepMounted
      ariaLabel={t('Record actions')}
      className="w-64 p-1"
      trigger={
        <Button
          ref={trigger}
          type="button"
          variant="outline"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          <GeneratedValue value="Actions" />
          <ChevronDown size={14} />
        </Button>
      }
    >
      <div
        id={id}
        ref={focusFirstAction}
        aria-label={t('Record actions')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            trigger.current?.focus()
          }
        }}
        onClick={(event) => {
          // Closing from a form's click would cancel its submission. The
          // popover keeps forms mounted through confirmation and save flows.
          if (event.target instanceof Element && event.target.closest('a[href]')) setOpen(false)
        }}
        className="space-y-0.5 [&_a]:flex [&_a]:min-h-11 [&_a]:w-full [&_a]:items-center [&_a]:gap-2 [&_a]:rounded-md [&_a]:px-3 [&_a]:py-2 [&_a]:text-sm [&_a]:no-underline [&_a:hover]:bg-slate-100 dark:[&_a:hover]:bg-slate-800 [&_a>button]:min-h-0 [&_a>button]:p-0 [&_button]:flex [&_button]:h-auto [&_button]:min-h-11 [&_button]:w-full [&_button]:justify-start [&_button]:gap-2 [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-2 [&_button]:text-left [&_button]:text-sm [&_button]:font-normal [&_button]:shadow-none [&_button:hover]:bg-slate-100 dark:[&_button:hover]:bg-slate-800 [&_form]:m-0"
      >
        <div className="text-slate-700 dark:text-slate-200 [&_button]:text-slate-700 dark:[&_button]:text-slate-200 [&>div]:contents">
          {children}
        </div>
        {destructive ? (
          <div className="mt-1 hidden border-t border-slate-200 pt-1 text-red-600 has-[a,button]:block dark:border-slate-700 dark:text-red-400 [&_button]:text-red-600 dark:[&_button]:text-red-400">
            {destructive}
          </div>
        ) : null}
      </div>
    </Popover>
  )
}
