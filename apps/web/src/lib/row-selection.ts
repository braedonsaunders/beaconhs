import { useCallback, useMemo, useState } from 'react'

type IdentifiedRow = { id: string }

export function visibleSelection(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  const allowed = new Set(visibleIds)
  return new Set([...selected].filter((id) => allowed.has(id)))
}

export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function toggleAllVisible(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  if (visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))) return new Set()
  return new Set(visibleIds)
}

/** Selection state shared by paginated record tables. Hidden-page IDs never reach bulk actions. */
export function useRowSelection(rows: readonly IdentifiedRow[]) {
  const visibleIds = useMemo(() => [...new Set(rows.map(({ id }) => id))], [rows])
  const [storedSelection, setStoredSelection] = useState<Set<string>>(() => new Set())
  const selected = useMemo(
    () => visibleSelection(storedSelection, visibleIds),
    [storedSelection, visibleIds],
  )
  const selectedIds = useMemo(() => [...selected], [selected])
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  const toggleOne = useCallback(
    (id: string) => {
      if (!visibleIds.includes(id)) return
      setStoredSelection((previous) => toggleSelection(visibleSelection(previous, visibleIds), id))
    },
    [visibleIds],
  )
  const toggleAll = useCallback(() => {
    setStoredSelection((previous) =>
      toggleAllVisible(visibleSelection(previous, visibleIds), visibleIds),
    )
  }, [visibleIds])
  const clear = useCallback(() => setStoredSelection(new Set()), [])

  return { selected, selectedIds, allSelected, toggleOne, toggleAll, clear }
}
