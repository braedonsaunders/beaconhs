'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export function DayPicker({ value }: { value: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-500">
      <label htmlFor="day">Day:</label>
      <input
        type="date"
        id="day"
        name="day"
        defaultValue={value}
        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
        onChange={(e) => {
          const next = new URLSearchParams(sp.toString())
          if (e.currentTarget.value) next.set('day', e.currentTarget.value)
          else next.delete('day')
          next.delete('page')
          router.push(`/kiosk-history?${next.toString()}`)
        }}
      />
    </span>
  )
}
