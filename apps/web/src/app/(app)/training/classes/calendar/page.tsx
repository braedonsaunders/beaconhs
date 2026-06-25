// Monthly calendar of scheduled training classes.
// Companion view to /training/classes (list view) — the coordinator
// switches between them via the toggle in the header.
//
// URL contract:
//   ?month=YYYY-MM   (defaults to "today" in server tz if omitted/invalid)
//
// Render: 7-col × N-row grid (N is 5 or 6 to cover the month). Each day cell
// stacks a chip per class scheduled that day; click → /training/classes/[id].

import Link from 'next/link'
import { and, asc, gte, lt } from 'drizzle-orm'
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus } from 'lucide-react'
import { Badge, Button, PageHeader } from '@beaconhs/ui'
import { trainingClasses, trainingCourses } from '@beaconhs/db/schema'
import { eq } from 'drizzle-orm'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from '../../_components/training-sub-nav'

export const metadata = { title: 'Class calendar' }
export const dynamic = 'force-dynamic'

// ---------- date utils (no extra library) ----------

function parseMonth(raw: string | undefined): { year: number; month: number } {
  // month is 1-12 in the URL ("2026-05"); internally we store the same 1-12.
  const m = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : null
  if (m) {
    const [ys, mos] = m.split('-')
    const y = Number(ys)
    const mo = Number(mos)
    if (Number.isFinite(y) && Number.isFinite(mo) && y >= 1970 && mo >= 1 && mo <= 12) {
      return { year: y, month: mo }
    }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function fmtMonth(year: number, month: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  // month is 1-12; convert to 0-11 for the Date arithmetic.
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

// Build a 6-row × 7-col grid that starts on the Sunday on/before the 1st of the
// month and ends on the Saturday on/after the last day. Returns 42 cells (or
// trimmed to 35 if the month perfectly fits 5 rows).
function buildGrid(
  year: number,
  month: number,
): {
  days: { date: Date; iso: string; inMonth: boolean; isToday: boolean }[]
  rows: number
} {
  const first = new Date(year, month - 1, 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay()) // Sunday-anchored
  const todayIso = new Date().toISOString().slice(0, 10)
  const cells: { date: Date; iso: string; inMonth: boolean; isToday: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const iso = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
      .getDate()
      .toString()
      .padStart(2, '0')}`
    cells.push({
      date: d,
      iso,
      inMonth: d.getMonth() + 1 === month,
      isToday: iso === todayIso,
    })
  }
  // If the last week is entirely in next month and the previous week is fully
  // in the current month, drop the trailing 7 to render 5 rows instead of 6.
  const lastRow = cells.slice(35, 42)
  const rows = lastRow.every((c) => !c.inMonth) ? 5 : 6
  return { days: cells.slice(0, rows * 7), rows }
}

// ---------- page ----------

type ClassChip = {
  id: string
  title: string
  courseName: string
  start: Date
  cancelled: boolean
  completed: boolean
}

export default async function TrainingClassesCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const { year, month } = parseMonth(pickString(sp.month))
  const ctx = await requireRequestContext()

  // Window: [first of visible month minus the leading Sundays] .. [last grid day + 1]
  const { days } = buildGrid(year, month)
  const firstCell = days[0]
  const lastCell = days[days.length - 1]
  if (!firstCell || !lastCell) {
    // Should never happen: buildGrid always returns at least 35 cells.
    throw new Error('Calendar grid is empty')
  }
  const windowStart = firstCell.date
  const windowEndExclusive = new Date(lastCell.date)
  windowEndExclusive.setDate(windowEndExclusive.getDate() + 1)

  const rows = await ctx.db((tx) =>
    tx
      .select({ cls: trainingClasses, course: trainingCourses })
      .from(trainingClasses)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingClasses.courseId))
      .where(
        and(
          gte(trainingClasses.startsAt, windowStart),
          lt(trainingClasses.startsAt, windowEndExclusive),
        ),
      )
      .orderBy(asc(trainingClasses.startsAt)),
  )

  // Bucket classes by local-date iso string.
  const byDay = new Map<string, ClassChip[]>()
  for (const r of rows) {
    const d = new Date(r.cls.startsAt)
    const iso = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
      .getDate()
      .toString()
      .padStart(2, '0')}`
    const list = byDay.get(iso) ?? []
    list.push({
      id: r.cls.id,
      title: r.cls.title,
      courseName: r.course.name,
      start: d,
      cancelled: !!r.cls.cancelledAt,
      completed: !!r.cls.completedAt,
    })
    byDay.set(iso, list)
  }

  const prev = shiftMonth(year, month, -1)
  const next = shiftMonth(year, month, 1)
  const today = new Date()
  const todayMonth = { year: today.getFullYear(), month: today.getMonth() + 1 }
  const isCurrentMonth = todayMonth.year === year && todayMonth.month === month

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Training calendar"
            description="Month at a glance — every scheduled class shown on the day it starts."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/training/classes">
                  <Button variant="outline">
                    <List size={14} /> List view
                  </Button>
                </Link>
                <Link href="/training/classes/new">
                  <Button>
                    <Plus size={14} /> Schedule new class
                  </Button>
                </Link>
              </div>
            }
          />
          <TrainingSubNav active="classes" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link
                href={`/training/classes/calendar?month=${fmtMonth(prev.year, prev.month)}`}
                aria-label="Previous month"
              >
                <Button variant="outline" size="sm">
                  <ChevronLeft size={14} />
                </Button>
              </Link>
              <div className="min-w-[10rem] text-center text-sm font-medium text-slate-800 dark:text-slate-200">
                {monthLabel(year, month)}
              </div>
              <Link
                href={`/training/classes/calendar?month=${fmtMonth(next.year, next.month)}`}
                aria-label="Next month"
              >
                <Button variant="outline" size="sm">
                  <ChevronRight size={14} />
                </Button>
              </Link>
              {!isCurrentMonth ? (
                <Link
                  href={`/training/classes/calendar?month=${fmtMonth(
                    todayMonth.year,
                    todayMonth.month,
                  )}`}
                >
                  <Button variant="ghost" size="sm">
                    Today
                  </Button>
                </Link>
              ) : null}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {rows.length} class{rows.length === 1 ? '' : 'es'} this view
            </div>
          </div>
        </>
      }
    >
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
          {DOW.map((d) => (
            <div key={d} className="px-2 py-2 text-center">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((cell, idx) => {
            const chips = byDay.get(cell.iso) ?? []
            const dayNum = cell.date.getDate()
            return (
              <div
                key={cell.iso + idx}
                className={[
                  'min-h-[110px] border-r border-b border-slate-100 p-1.5 dark:border-slate-800',
                  idx % 7 === 6 ? 'border-r-0' : '',
                  cell.inMonth
                    ? 'bg-white dark:bg-slate-900'
                    : 'bg-slate-50/60 dark:bg-slate-900/80',
                ].join(' ')}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={[
                      'inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums',
                      cell.isToday
                        ? 'bg-teal-600 text-white'
                        : cell.inMonth
                          ? 'text-slate-700 dark:text-slate-300'
                          : 'text-slate-400',
                    ].join(' ')}
                  >
                    {dayNum}
                  </span>
                  {chips.length > 3 ? (
                    <span className="text-[10px] text-slate-400">{chips.length}</span>
                  ) : null}
                </div>
                <ul className="space-y-0.5">
                  {chips.slice(0, 4).map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/training/classes/${c.id}`}
                        title={`${c.title} — ${c.courseName}`}
                        className={[
                          'block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight transition-colors',
                          c.cancelled
                            ? 'bg-slate-100 text-slate-500 line-through hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
                            : c.completed
                              ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-500/10'
                              : 'bg-teal-50 text-teal-900 hover:bg-teal-100 dark:bg-teal-500/10 dark:text-teal-200',
                        ].join(' ')}
                      >
                        <span className="text-[10px] text-slate-500 tabular-nums dark:text-slate-400">
                          {c.start.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>{' '}
                        <span className="font-medium">{c.title}</span>
                      </Link>
                    </li>
                  ))}
                  {chips.length > 4 ? (
                    <li className="px-1.5 text-[10px] text-slate-400">+{chips.length - 4} more</li>
                  ) : null}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
          <CalendarDays size={14} className="text-slate-400" />
          <span>No classes scheduled in {monthLabel(year, month)}.</span>
          <Badge variant="outline" className="ml-auto">
            tip
          </Badge>
        </div>
      ) : null}
    </ListPageLayout>
  )
}
