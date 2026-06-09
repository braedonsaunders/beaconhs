'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Input } from '@beaconhs/ui'

export function SearchInput({
  placeholder = 'Search…',
  paramKey = 'q',
}: {
  placeholder?: string
  paramKey?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const [value, setValue] = useState(search.get(paramKey) ?? '')

  useEffect(() => {
    setValue(search.get(paramKey) ?? '')
  }, [search, paramKey])

  useEffect(() => {
    const handle = setTimeout(() => {
      const next = new URLSearchParams(search.toString())
      if (value) next.set(paramKey, value)
      else next.delete(paramKey)
      // Reset to page 1 when search changes
      next.delete('page')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    }, 250)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-2 left-2.5 text-slate-400 dark:text-slate-500" size={16} />
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 pr-9 pl-9"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setValue('')}
          className="absolute top-2 right-2.5 text-slate-400 dark:text-slate-500 hover:text-slate-600"
        >
          <X size={16} />
        </button>
      ) : null}
    </div>
  )
}
