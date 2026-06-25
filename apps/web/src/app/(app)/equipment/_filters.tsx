'use client'

// Type + Category dropdown filters for the equipment register. Searchable
// (69 types / 39 categories would be a chip wall) — each navigates on change
// via searchParams, mirroring the FilterChips contract.

import { useRouter } from 'next/navigation'
import { SearchSelect, type SelectOption } from '@beaconhs/ui'

export function EquipmentTypeCategoryFilters({
  basePath,
  currentParams,
  types,
  categories,
}: {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  types: SelectOption[]
  categories: SelectOption[]
}) {
  const router = useRouter()
  const cur = (k: string) => {
    const v = currentParams[k]
    return (Array.isArray(v) ? v[0] : v) ?? ''
  }
  function nav(key: string, value: string) {
    const usp = new URLSearchParams()
    for (const [k, v] of Object.entries(currentParams)) {
      const s = Array.isArray(v) ? v[0] : v
      if (s != null && s !== '') usp.set(k, s)
    }
    if (value) usp.set(key, value)
    else usp.delete(key)
    usp.delete('page')
    const qs = usp.toString()
    router.push(qs ? `${basePath}?${qs}` : basePath)
  }
  return (
    <>
      <SearchSelect
        value={cur('type')}
        onChange={(v) => nav('type', v)}
        options={types}
        placeholder="All types"
        searchPlaceholder="Search types…"
        sheetTitle="Filter by type"
        ariaLabel="Filter by type"
        clearable
        emptyLabel="All types"
        triggerClassName="h-9 min-w-[9rem] text-sm"
      />
      <SearchSelect
        value={cur('category')}
        onChange={(v) => nav('category', v)}
        options={categories}
        placeholder="All categories"
        searchPlaceholder="Search categories…"
        sheetTitle="Filter by category"
        ariaLabel="Filter by category"
        clearable
        emptyLabel="All categories"
        triggerClassName="h-9 min-w-[9rem] text-sm"
      />
    </>
  )
}
