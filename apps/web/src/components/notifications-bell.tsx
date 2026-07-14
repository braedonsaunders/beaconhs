'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Bell, ExternalLink, Settings } from 'lucide-react'
import { Popover } from '@beaconhs/ui'

/**
 * Bell icon in the top bar. The badge reflects the unread-count fetched in
 * the layout, but the dropdown is a small static menu — Inbox + Preferences.
 * The menu is portaled via <Popover> so it escapes the AppShell's
 * overflow-hidden container.
 */
export function NotificationsBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('Shell')
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-64"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t('notifications')}
          aria-expanded={open}
          aria-haspopup="menu"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <Bell size={16} />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-medium text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>
      }
    >
      <div role="menu">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
          <div className="text-sm font-medium">{t('notifications')}</div>
          {unread > 0 ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('unread', { count: unread > 99 ? 99 : unread })}
            </span>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">{t('allRead')}</span>
          )}
        </div>
        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          role="menuitem"
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60"
        >
          <ExternalLink size={14} className="text-slate-500 dark:text-slate-400" />
          <span>{t('viewInbox')}</span>
        </Link>
        <Link
          href="/my/notifications"
          onClick={() => setOpen(false)}
          role="menuitem"
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60"
        >
          <Settings size={14} className="text-slate-500 dark:text-slate-400" />
          <span>{t('preferences')}</span>
        </Link>
      </div>
    </Popover>
  )
}
