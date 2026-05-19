import Link from 'next/link'
import { Bell } from 'lucide-react'

export function NotificationsBell({ unread }: { unread: number }) {
  return (
    <Link
      href="/notifications"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      aria-label="Notifications"
    >
      <Bell size={16} />
      {unread > 0 ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium leading-none text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  )
}
