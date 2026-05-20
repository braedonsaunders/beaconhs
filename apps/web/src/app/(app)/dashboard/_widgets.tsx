'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Calendar,
  GraduationCap,
  Inbox,
  ListChecks,
  MapPin,
  ShieldAlert,
  Wrench,
} from 'lucide-react'
import { Badge } from '@beaconhs/ui'
import { AnimatedBar } from './_bar'

/**
 * Co-located bottom-half widgets. Each is a small client component because
 * we want the motion (hover lift, bar grow) — but the *data* still comes
 * from the RSC at the top of `page.tsx`, which means no client-side fetching.
 *
 * Each widget shares the same shell: a card with a labelled header, a thin
 * divider row, then a small list of items. We deliberately avoid `divide-y`
 * here so we can use motion-aware row-level hover effects.
 */

// ----- Shared shell ---------------------------------------------------------

function WidgetShell({
  title,
  caption,
  icon: Icon,
  href,
  hrefLabel = 'View all',
  accent = 'slate',
  children,
}: {
  title: string
  caption?: string
  icon?: React.ComponentType<{ size?: number; className?: string }>
  href?: string
  hrefLabel?: string
  accent?: 'slate' | 'rose' | 'amber' | 'teal' | 'sky'
  children: React.ReactNode
}) {
  const iconAccent =
    accent === 'rose'
      ? 'bg-rose-50 text-rose-600 ring-rose-100'
      : accent === 'amber'
        ? 'bg-amber-50 text-amber-600 ring-amber-100'
        : accent === 'teal'
          ? 'bg-teal-50 text-teal-700 ring-teal-100'
          : accent === 'sky'
            ? 'bg-sky-50 text-sky-700 ring-sky-100'
            : 'bg-slate-100 text-slate-600 ring-slate-200'
  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.18 }}
      className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          {Icon ? (
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset ${iconAccent}`}
            >
              <Icon size={14} />
            </span>
          ) : null}
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {caption ? (
              <p className="text-[11px] text-slate-500">{caption}</p>
            ) : null}
          </div>
        </div>
        {href ? (
          <Link
            href={href as any}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-teal-700"
          >
            {hrefLabel}
            <ArrowRight size={11} />
          </Link>
        ) : null}
      </div>
      <div className="flex-1 px-2.5 py-2">{children}</div>
    </motion.div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center px-3 py-8 text-center text-xs text-slate-500">
      {children}
    </div>
  )
}

// ----- Recent incidents -----------------------------------------------------

type RecentIncident = {
  id: string
  reference: string
  title: string
  severity: string
  type: string
  occurredAt: string | Date
}

export function RecentIncidentsWidget({ items }: { items: RecentIncident[] }) {
  return (
    <WidgetShell
      title="Recent incidents"
      caption="Last 5 reported"
      icon={AlertTriangle}
      href="/incidents"
      accent="rose"
    >
      {items.length === 0 ? (
        <EmptyRow>No incidents reported. Quiet on the front.</EmptyRow>
      ) : (
        <ul className="space-y-0.5">
          {items.map((i, idx) => {
            const variant: 'destructive' | 'warning' | 'secondary' =
              i.severity === 'fatality' || i.severity === 'lost_time'
                ? 'destructive'
                : i.severity === 'medical_aid'
                  ? 'warning'
                  : 'secondary'
            return (
              <motion.li
                key={i.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
              >
                <Link
                  href={`/incidents/${i.id}` as any}
                  className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700">
                        {i.title}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      <span className="font-mono">{i.reference}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span>{relativeTime(i.occurredAt)}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span className="capitalize">{i.type.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                  <Badge variant={variant} className="shrink-0 capitalize">
                    {i.severity.replace(/_/g, ' ')}
                  </Badge>
                </Link>
              </motion.li>
            )
          })}
        </ul>
      )}
    </WidgetShell>
  )
}

// ----- Due CAs --------------------------------------------------------------

type DueCa = {
  id: string
  reference: string
  title: string
  severity: string
  dueOn: string | null
}

export function DueCAsWidget({ items, todayIso }: { items: DueCa[]; todayIso: string }) {
  return (
    <WidgetShell
      title="Corrective actions due"
      caption="Next 5 by due date"
      icon={ListChecks}
      href="/corrective-actions"
      accent="amber"
    >
      {items.length === 0 ? (
        <EmptyRow>No open corrective actions. Inbox zero.</EmptyRow>
      ) : (
        <ul className="space-y-0.5">
          {items.map((c, idx) => {
            const aging = caAging(c.dueOn, todayIso)
            return (
              <motion.li
                key={c.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
              >
                <Link
                  href={`/corrective-actions/${c.id}` as any}
                  className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${aging.dotColor}`}
                        aria-hidden
                      />
                      <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700">
                        {c.reference}
                      </span>
                      <span className="truncate text-sm text-slate-600">— {c.title}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      Due {c.dueOn ?? '—'} · severity {c.severity}
                    </div>
                  </div>
                  <Badge variant={aging.badgeVariant} className="shrink-0">
                    {aging.label}
                  </Badge>
                </Link>
              </motion.li>
            )
          })}
        </ul>
      )}
    </WidgetShell>
  )
}

// ----- Top sites bar chart --------------------------------------------------

type TopSite = { siteId: string | null; siteName: string; incidents: number }

export function TopSitesWidget({ items }: { items: TopSite[] }) {
  const max = items.reduce((m, s) => Math.max(m, s.incidents), 0) || 1
  return (
    <WidgetShell
      title="Top sites by incidents"
      caption="Last 90 days"
      icon={MapPin}
      href="/incidents"
      accent="sky"
    >
      {items.length === 0 ? (
        <EmptyRow>No incidents in the last 90 days.</EmptyRow>
      ) : (
        <ul className="space-y-1.5 px-2.5 py-1.5">
          {items.map((s, idx) => {
            const pct = (s.incidents / max) * 100
            return (
              <motion.li
                key={s.siteId ?? `none-${idx}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.06 + idx * 0.05, duration: 0.3 }}
                className="rounded-lg px-1 py-1.5"
              >
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold tabular-nums text-slate-700">
                      {idx + 1}
                    </span>
                    <span className="truncate font-medium text-slate-800">
                      {s.siteName}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-rose-700">
                    {s.incidents}
                  </span>
                </div>
                <div className="mt-1.5">
                  <AnimatedBar
                    pct={pct}
                    delay={0.1 + idx * 0.06}
                    tone={pct > 75 ? 'rose' : pct > 40 ? 'amber' : 'teal'}
                  />
                </div>
              </motion.li>
            )
          })}
        </ul>
      )}
    </WidgetShell>
  )
}

// ----- Expiring training ----------------------------------------------------

type ExpiringTraining = {
  personId: string
  personName: string
  courseName: string
  expiresOn: string
}

export function ExpiringTrainingWidget({
  items,
  todayIso,
}: {
  items: ExpiringTraining[]
  todayIso: string
}) {
  return (
    <WidgetShell
      title="Expiring training (30 days)"
      caption="Sorted by urgency"
      icon={GraduationCap}
      href="/training"
      accent="teal"
    >
      {items.length === 0 ? (
        <EmptyRow>No certs lapsing in the next 30 days.</EmptyRow>
      ) : (
        <ul className="space-y-0.5">
          {items.slice(0, 5).map((row, idx) => {
            const days = daysBetween(todayIso, row.expiresOn)
            const tone = days <= 7 ? 'destructive' : days <= 14 ? 'warning' : 'secondary'
            return (
              <motion.li
                key={`${row.personId}-${row.expiresOn}-${row.courseName}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
              >
                <Link
                  href={`/people/${row.personId}` as any}
                  className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Calendar size={11} className="shrink-0 text-slate-400" />
                      <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700">
                        {row.personName}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      {row.courseName} · expires {row.expiresOn}
                    </div>
                  </div>
                  <Badge variant={tone} className="shrink-0 tabular-nums">
                    {days <= 0 ? 'today' : `${days}d`}
                  </Badge>
                </Link>
              </motion.li>
            )
          })}
        </ul>
      )}
    </WidgetShell>
  )
}

// ----- Inbox preview --------------------------------------------------------

type InboxItem = {
  id: string
  title: string
  body: string | null
  category: string
  linkPath: string | null
  occurredAt: string | Date
}

export function InboxWidget({ items }: { items: InboxItem[] }) {
  return (
    <WidgetShell
      title="My inbox"
      caption={`${items.length} unread`}
      icon={Inbox}
      href="/my/notifications"
      accent="slate"
    >
      {items.length === 0 ? (
        <EmptyRow>
          <span className="inline-flex items-center gap-2">
            <Bell size={12} className="text-emerald-500" />
            Inbox zero. Nice.
          </span>
        </EmptyRow>
      ) : (
        <ul className="space-y-0.5">
          {items.map((n, idx) => {
            const Inner = (
              <div className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                    <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700">
                      {n.title}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">
                    {n.body ?? n.category}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {relativeTime(n.occurredAt)}
                </span>
              </div>
            )
            return (
              <motion.li
                key={n.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
              >
                {n.linkPath ? (
                  <Link href={n.linkPath as any}>{Inner}</Link>
                ) : (
                  Inner
                )}
              </motion.li>
            )
          })}
        </ul>
      )}
    </WidgetShell>
  )
}

// ----- Most-overdue CAs -----------------------------------------------------

type OverdueCa = {
  id: string
  reference: string
  title: string
  dueOn: string | null
  daysOverdue: number
}

export function OverdueCAsWidget({ items }: { items: OverdueCa[] }) {
  return (
    <WidgetShell
      title="Most-overdue corrective actions"
      caption="Highest days past due"
      icon={Wrench}
      href="/corrective-actions/reports/overdue"
      accent="rose"
    >
      {items.length === 0 ? (
        <EmptyRow>
          <span className="inline-flex items-center gap-2">
            <ShieldAlert size={12} className="text-emerald-500" />
            Nothing overdue.
          </span>
        </EmptyRow>
      ) : (
        <ul className="space-y-0.5">
          {items.map((c, idx) => (
            <motion.li
              key={c.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
            >
              <Link
                href={`/corrective-actions/${c.id}` as any}
                className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700">
                      <span className="font-mono text-slate-500">{c.reference}</span>{' '}
                      <span>— {c.title}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    Was due {c.dueOn ?? '—'}
                  </div>
                </div>
                <Badge variant="destructive" className="shrink-0 tabular-nums">
                  {c.daysOverdue}d
                </Badge>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </WidgetShell>
  )
}

// ----- helpers --------------------------------------------------------------

function relativeTime(value: string | Date) {
  const then = typeof value === 'string' ? new Date(value) : value
  const now = Date.now()
  const diff = Math.round((now - then.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)}d ago`
  return then.toLocaleDateString()
}

function daysBetween(todayIso: string, targetIso: string) {
  const today = new Date(`${todayIso}T00:00:00Z`)
  const target = new Date(`${targetIso}T00:00:00Z`)
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
}

function caAging(
  dueOn: string | null,
  todayIso: string,
): {
  badgeVariant: 'destructive' | 'warning' | 'success' | 'secondary'
  label: string
  dotColor: string
} {
  if (!dueOn) {
    return { badgeVariant: 'secondary', label: 'no date', dotColor: 'bg-slate-300' }
  }
  const days = daysBetween(todayIso, dueOn)
  if (days < 0) {
    return {
      badgeVariant: 'destructive',
      label: `${Math.abs(days)}d overdue`,
      dotColor: 'bg-rose-500',
    }
  }
  if (days <= 7) {
    return {
      badgeVariant: 'success',
      label: `${days}d left`,
      dotColor: 'bg-emerald-500',
    }
  }
  if (days <= 30) {
    return {
      badgeVariant: 'warning',
      label: `${days}d left`,
      dotColor: 'bg-amber-500',
    }
  }
  return {
    badgeVariant: 'secondary',
    label: `${days}d left`,
    dotColor: 'bg-slate-400',
  }
}
