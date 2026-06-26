'use client'

import { useEffect, useId, useRef, useState, type Ref } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { Button, cn } from '@beaconhs/ui'

type DeleteIntegrationButtonProps = {
  id: string
  name: string
  deleteAction: (formData: FormData) => Promise<void>
  kind?: 'connection' | 'automation'
  iconOnly?: boolean
  label?: string
  className?: string
}

function SubmitDeleteButton({
  kind,
  buttonRef,
}: {
  kind: 'connection' | 'automation'
  buttonRef?: Ref<HTMLButtonElement>
}) {
  const { pending } = useFormStatus()
  return (
    <Button ref={buttonRef} type="submit" variant="destructive" disabled={pending}>
      {pending ? 'Removing…' : `Remove ${kind}`}
    </Button>
  )
}

export function DeleteIntegrationButton({
  id,
  name,
  deleteAction,
  kind = 'connection',
  iconOnly = true,
  label,
  className,
}: DeleteIntegrationButtonProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    confirmRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          iconOnly
            ? 'rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400'
            : 'inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-red-600 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:border-slate-800 dark:bg-slate-900 dark:text-red-400 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300',
          className,
        )}
        title={label ?? `Remove ${kind}`}
        aria-label={label ?? `Remove ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Trash2 size={iconOnly ? 15 : 14} />
        {iconOnly ? null : <span>{label ?? `Remove ${kind}`}</span>}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div className="flex gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
                  <AlertTriangle size={17} />
                </span>
                <div>
                  <h2
                    id={titleId}
                    className="text-base font-semibold text-slate-900 dark:text-slate-100"
                  >
                    Remove {name}?
                  </h2>
                  <p id={descriptionId} className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    This {kind} will be disconnected and hidden from active integrations. Existing
                    synced records in BeaconHS are retained.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <form action={deleteAction} className="flex justify-end gap-2 px-5 py-4">
              <input type="hidden" name="id" value={id} />
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitDeleteButton kind={kind} buttonRef={confirmRef} />
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
