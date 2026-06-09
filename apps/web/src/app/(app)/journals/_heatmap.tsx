'use client'

// Year-in-pixels: a GitHub-style contribution grid of journaling activity.
// Click any cell to jump to (or start) that day's entry.

import { useMemo } from 'react'
import type { HeatmapCell } from './_types'

const WEEKS = 53
const MONTH_ABBR = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function intensity(count: number): string {
  if (count <= 0) return 'bg-slate-100 hover:bg-slate-200'
  if (count === 1) return 'bg-teal-200 hover:bg-teal-300'
  if (count === 2) return 'bg-teal-400 hover:bg-teal-500'
  if (count === 3) return 'bg-teal-500 hover:bg-teal-600'
  return 'bg-teal-700 hover:bg-teal-800'
}

export function Heatmap({
  data,
  onPick,
}: {
  data: HeatmapCell[]
  onPick: (date: string) => void
}) {
  const { columns, monthTicks } = useMemo(() => {
    const counts = new Map(data.map((d) => [d.date, d.count]))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Anchor the last column on this week; walk back WEEKS columns to a Sunday.
    const end = new Date(today)
    const start = new Date(today)
    start.setDate(start.getDate() - (WEEKS - 1) * 7 - today.getDay())

    const cols: { date: string; count: number; future: boolean }[][] = []
    const ticks: { col: number; label: string }[] = []
    let lastMonth = -1
    const cursor = new Date(start)
    for (let w = 0; w < WEEKS; w++) {
      const col: { date: string; count: number; future: boolean }[] = []
      for (let d = 0; d < 7; d++) {
        const iso = cursor.toISOString().slice(0, 10)
        const month = cursor.getMonth()
        if (d === 0 && month !== lastMonth) {
          ticks.push({ col: w, label: MONTH_ABBR[month] ?? '' })
          lastMonth = month
        }
        col.push({ date: iso, count: counts.get(iso) ?? 0, future: cursor > end })
        cursor.setDate(cursor.getDate() + 1)
      }
      cols.push(col)
    }
    return { columns: cols, monthTicks: ticks }
  }, [data])

  return (
    <div className="overflow-x-auto pb-1 app-scroll">
      <div className="inline-flex flex-col gap-1">
        <div className="flex gap-[3px] pl-[2px] text-[8px] leading-none text-slate-400">
          {columns.map((_, w) => {
            const tick = monthTicks.find((t) => t.col === w)
            return (
              <div key={w} className="w-[10px] text-center">
                {tick?.label ?? ''}
              </div>
            )
          })}
        </div>
        <div className="flex gap-[3px]">
          {columns.map((col, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {col.map((cell) =>
                cell.future ? (
                  <div key={cell.date} className="h-[10px] w-[10px]" />
                ) : (
                  <button
                    key={cell.date}
                    type="button"
                    title={`${cell.date} · ${cell.count} ${cell.count === 1 ? 'entry' : 'entries'}`}
                    onClick={() => onPick(cell.date)}
                    className={`h-[10px] w-[10px] rounded-[2px] ring-1 ring-inset ring-black/[0.03] transition-colors ${intensity(cell.count)}`}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
