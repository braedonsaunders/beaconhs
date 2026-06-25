'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Check, ChevronDown, Shield } from 'lucide-react'
import { Popover, cn } from '@beaconhs/ui'

// Workspace switch (super-admin only) — flips between the tenant workspace and
// the platform (super-admin) area. Sits beside the tenant switcher. Switching to
// Platform also swaps the whole left sidebar to the platform nav (see
// use-platform-nav.ts); the dropdown itself is just the two modes, not a page list.
export function PlatformMenu() {
  const [open, setOpen] = useState(false)
  const onPlatform = (usePathname() ?? '').startsWith('/platform')

  const options = [
    {
      key: 'tenant',
      href: '/dashboard',
      label: 'Tenant workspace',
      desc: 'Modules for the active tenant',
      icon: <Building2 size={15} />,
      active: !onPlatform,
    },
    {
      key: 'platform',
      href: '/platform',
      label: 'Platform',
      desc: 'Deployment-wide super-admin tools',
      icon: <Shield size={15} />,
      active: onPlatform,
    },
  ]

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
          aria-label="Switch workspace"
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors',
            onPlatform
              ? 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100'
              : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40',
          )}
        >
          <Shield size={14} className="shrink-0" />
          <span className="hidden sm:inline">Platform</span>
          <ChevronDown size={14} className="shrink-0 text-amber-500 dark:text-amber-400/70" />
        </button>
      }
    >
      <div className="border-b border-slate-100 px-3 py-2 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
        Switch workspace
      </div>
      <ul className="py-1" role="menu">
        {options.map((o) => (
          <li key={o.key}>
            <Link
              href={o.href as never}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span className="flex items-start gap-2.5">
                <span className="mt-0.5 text-slate-500 dark:text-slate-400">{o.icon}</span>
                <span className="flex flex-col">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{o.label}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{o.desc}</span>
                </span>
              </span>
              {o.active ? (
                <Check size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </Popover>
  )
}
