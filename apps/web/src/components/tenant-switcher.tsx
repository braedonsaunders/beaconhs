'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, ChevronDown } from 'lucide-react'
import { Popover } from '@beaconhs/ui'
import { setActiveTenant } from '@/lib/actions'

type Tenant = { id: string; name: string; slug: string }

export function TenantSwitcher({
  current,
  available,
  isSuperAdmin,
}: {
  current: { id: string; name: string }
  available: Tenant[]
  isSuperAdmin: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  function pick(id: string) {
    if (id === current.id) {
      setOpen(false)
      return
    }
    start(async () => {
      const res = await setActiveTenant(id)
      if (res.ok) {
        setOpen(false)
        router.refresh()
      } else {
        alert(res.error ?? 'Could not switch tenant')
      }
    })
  }

  // Don't show the picker if a regular user only has one membership.
  if (!isSuperAdmin && available.length <= 1) {
    return (
      <span className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 dark:text-slate-200">
        <Building2 size={14} />
        {current.name}
      </span>
    )
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
          className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60"
        >
          <Building2 size={14} />
          {pending ? 'Switching…' : current.name}
          <ChevronDown size={14} className="text-slate-400 dark:text-slate-500" />
        </button>
      }
    >
      <div className="border-b border-slate-100 px-3 py-2 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
        {isSuperAdmin ? `All tenants (${available.length})` : 'Your tenants'}
      </div>
      <ul className="max-h-72 overflow-y-auto py-1">
        {available.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => pick(t.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span className="flex flex-col">
                <span className="font-medium text-slate-900 dark:text-slate-100">{t.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{t.slug}</span>
              </span>
              {t.id === current.id ? (
                <Check size={14} className="text-teal-700 dark:text-teal-300" />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  )
}
