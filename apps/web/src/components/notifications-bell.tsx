'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, ExternalLink, Settings } from 'lucide-react'

/**
 * Bell icon in the top bar. The badge reflects the unread-count fetched in
 * the layout, but the dropdown is a small static menu — Inbox + Preferences.
 * We keep the network round-trip out of the click path by linking to the
 * full inbox page rather than fetching the latest notifications inline.
 */
export function NotificationsBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <Bell size={16} />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <div className="text-sm font-medium">Notifications</div>
            {unread > 0 ? (
              <span className="text-xs text-slate-500">
                {unread > 99 ? '99+' : unread} unread
              </span>
            ) : (
              <span className="text-xs text-slate-400">All read</span>
            )}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
          >
            <ExternalLink size={14} className="text-slate-500" />
            <span>View inbox</span>
          </Link>
          <Link
            href="/my/notifications"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
          >
            <Settings size={14} className="text-slate-500" />
            <span>Preferences</span>
          </Link>
        </div>
      ) : null}
    </div>
  )
}
