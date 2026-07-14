'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown, UserCog } from 'lucide-react'
import { Popover } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { setActiveRole } from '@/lib/actions'

type Role = { id: string; name: string; key: string }

/**
 * Lets a user who holds more than one role act under a single role at a time —
 * the role analogue of the tenant switcher. Picking a role narrows the whole
 * session's permissions + scopes to that role; "All roles" restores the union.
 * Renders nothing when the user has one role or fewer (nothing to switch).
 */
export function RoleSwitcher({
  current,
  available,
}: {
  /** `id: null` means the union of all roles ("All roles"). */
  current: { id: string | null; name: string }
  available: Role[]
}) {
  const router = useRouter()
  const t = useTranslations('Shell')
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  if (available.length <= 1) return null

  function pick(id: string | null) {
    if (id === current.id) {
      setOpen(false)
      return
    }
    start(async () => {
      const res = await setActiveRole(id)
      if (res.ok) {
        setOpen(false)
        router.refresh()
      } else {
        toast.error(res.error ?? t('couldNotSwitchRole'))
      }
    })
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-64"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60"
        >
          <UserCog size={14} className="shrink-0" />
          <span className="truncate">{pending ? t('switching') : current.name}</span>
          <ChevronDown size={14} className="shrink-0 text-slate-400 dark:text-slate-500" />
        </button>
      }
    >
      <div className="border-b border-slate-100 px-3 py-2 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
        {t('actingAsRole')}
      </div>
      <ul className="max-h-72 overflow-y-auto py-1">
        <li>
          <button
            type="button"
            onClick={() => pick(null)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            <span className="flex flex-col">
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {t('allRoles')}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('combinedPermissions')}
              </span>
            </span>
            {current.id === null ? (
              <Check size={14} className="text-teal-700 dark:text-teal-300" />
            ) : null}
          </button>
        </li>
        {available.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => pick(r.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span className="flex flex-col">
                <span className="font-medium text-slate-900 dark:text-slate-100">{r.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{r.key}</span>
              </span>
              {r.id === current.id ? (
                <Check size={14} className="text-teal-700 dark:text-teal-300" />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  )
}
