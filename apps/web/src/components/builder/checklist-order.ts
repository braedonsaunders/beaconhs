type SequencedItem = { sequence: number }
type IdentifiedItem = { id: string }
type GroupedSequencedItem = IdentifiedItem & SequencedItem & { groupId: string | null }

/** Returns a new array with a contiguous, zero-based sequence. */
export function resequenceItems<T extends SequencedItem>(items: readonly T[]): T[] {
  return items.map((item, sequence) => ({ ...item, sequence }))
}

/** Replaces one scoped slice without dropping items owned by another scope. */
export function replaceScopedItems<T>(
  all: readonly T[],
  replacements: readonly T[],
  inScope: (item: T) => boolean,
): T[] {
  return [...all.filter((item) => !inScope(item)), ...replacements]
}

/** Applies a group and contiguous sequence to a reordered criterion slice. */
export function sequenceCriteria<T extends GroupedSequencedItem>(
  criteria: readonly T[],
  groupId: string | null,
): T[] {
  return criteria.map((criterion, sequence) => ({ ...criterion, groupId, sequence }))
}

/** Replaces identified records while leaving every unrelated record intact. */
export function replaceItemsById<T extends IdentifiedItem>(
  all: readonly T[],
  replacements: readonly T[],
): T[] {
  const replacedIds = new Set(replacements.map((item) => item.id))
  return [...all.filter((item) => !replacedIds.has(item.id)), ...replacements]
}

/** Moves one item by a single step, or returns null at either boundary. */
export function moveItemById<T extends IdentifiedItem>(
  items: readonly T[],
  id: string,
  delta: -1 | 1,
): T[] | null {
  const from = items.findIndex((item) => item.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= items.length) return null
  const next = [...items]
  ;[next[from], next[to]] = [next[to]!, next[from]!]
  return next
}
