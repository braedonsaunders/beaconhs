'use client'

import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

// The desktop nav rail. Collapses to an icon-only strip; the choice is persisted
// in a cookie so the server can render the correct width on the next load (no
// width flash). Hosts the brand and the nav — the theme switch and the build
// version live in the account menu, which is where the app's other per-user
// settings already are.

import { useCallback, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@beaconhs/ui'
import { Logo } from './brand-logo'
import { SidebarNav, type SidebarNavGroup } from './sidebar-nav'
import { useNavGroups } from './use-platform-nav'

const COOKIE = 'sidebar_collapsed'

export function AppSidebar({
  groups,
  defaultCollapsed = false,
}: {
  groups: SidebarNavGroup[]
  defaultCollapsed?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const t = useTranslations('Shell')
  const navGroups = useNavGroups(groups)

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      try {
        document.cookie = `${COOKIE}=${next ? '1' : '0'};path=/;max-age=31536000;samesite=lax`
      } catch {
        /* cookies unavailable — stays in-memory */
      }
      return next
    })
  }, [])

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ease-out lg:flex',
        'dark:border-slate-800 dark:bg-slate-900',
        collapsed ? 'w-[4.25rem]' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center border-b border-slate-200 px-3 dark:border-slate-800',
          collapsed ? 'justify-center' : 'gap-2',
        )}
      >
        <GeneratedValue value={collapsed ? null : <Logo className="h-7 w-auto" />} />
        <button
          type="button"
          onClick={toggle}
          aria-label={tGeneratedValue(collapsed ? t('expandSidebar') : t('collapseSidebar'))}
          title={tGeneratedValue(collapsed ? t('expandSidebar') : t('collapseSidebar'))}
          className={cn(
            'grid h-8 w-8 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200',
            collapsed ? '' : 'ml-auto',
          )}
        >
          <GeneratedValue
            value={collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          />
        </button>
      </div>

      <SidebarNav groups={navGroups} collapsed={collapsed} />
    </aside>
  )
}
