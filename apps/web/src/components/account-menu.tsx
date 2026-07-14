'use client'

// Top-bar account menu: identity header, personal navigation, theme switch, and
// sign-out — all in one portal-based Popover (mirrors TenantSwitcher/PlatformMenu).
// Replaces the old inert "Account" label + standalone sign-out button.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bell, ChevronDown, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { Popover } from '@beaconhs/ui'
import { signOut } from '@beaconhs/auth/client'
import { ThemeToggle } from './theme-toggle'

// Two-letter monogram from a display name, falling back to the email. Handles the
// "Last, First" directory convention so the initials read First+Last either way.
function initialsFrom(name: string, email: string): string {
  const base = (name.trim() || email.trim()).trim()
  if (!base) return '?'
  const ordered = base.includes(',') ? base.split(',').reverse().join(' ') : base
  const parts = ordered.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return base.slice(0, 1).toUpperCase()
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

const itemClass =
  'flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60'

export function AccountMenu({
  name,
  email,
  isSuperAdmin,
}: {
  name: string
  email: string
  isSuperAdmin: boolean
}) {
  const router = useRouter()
  const t = useTranslations('Shell')
  const common = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [pending, startSignOut] = useTransition()
  const label = name || email || common('account')
  const initials = initialsFrom(name, email)

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
          aria-label={t('accountMenu')}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex shrink-0 items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
            {initials}
          </span>
          <span className="hidden max-w-[10rem] truncate sm:inline">{label}</span>
          <ChevronDown
            size={14}
            className="hidden shrink-0 text-slate-400 sm:inline dark:text-slate-500"
          />
        </button>
      }
    >
      <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-3 dark:border-slate-800">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
          {initials}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {label}
          </span>
          {email ? (
            <span className="truncate text-xs text-slate-500 dark:text-slate-400">{email}</span>
          ) : null}
        </span>
      </div>

      {isSuperAdmin ? (
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-1.5 text-xs font-medium text-amber-700 dark:border-slate-800 dark:text-amber-300">
          <ShieldCheck size={13} className="shrink-0" />
          {t('superAdmin')}
        </div>
      ) : null}

      <nav className="py-1" role="menu">
        <Link href="/account" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
          <Settings size={15} className="text-slate-500 dark:text-slate-400" />
          {t('accountSettings')}
        </Link>
        <Link href="/my" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
          <UserRound size={15} className="text-slate-500 dark:text-slate-400" />
          {t('myWork')}
        </Link>
        <Link
          href="/notifications/preferences"
          role="menuitem"
          onClick={() => setOpen(false)}
          className={itemClass}
        >
          <Bell size={15} className="text-slate-500 dark:text-slate-400" />
          {t('notificationPreferences')}
        </Link>
      </nav>

      <div className="border-t border-slate-100 px-3 py-2.5 dark:border-slate-800">
        <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          {t('theme')}
        </div>
        <ThemeToggle />
      </div>

      <div className="border-t border-slate-100 p-1 dark:border-slate-800">
        <button
          type="button"
          disabled={pending}
          role="menuitem"
          onClick={() =>
            startSignOut(async () => {
              await signOut()
              router.replace('/login')
            })
          }
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800/60"
        >
          <LogOut size={15} className="text-slate-500 dark:text-slate-400" />
          {pending ? t('signingOut') : t('signOut')}
        </button>
      </div>
    </Popover>
  )
}
