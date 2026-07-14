import { isUuid } from '../../../lib/list-params'
import type { GroupBy, TreeCursor, TreeNode } from './_types'

export function isTreeCursor(value: unknown): value is TreeCursor {
  if (!value || typeof value !== 'object') return false
  const cursor = value as Partial<TreeCursor>
  if (
    typeof cursor.entryDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(cursor.entryDate) ||
    typeof cursor.asOf !== 'string' ||
    typeof cursor.createdAt !== 'string' ||
    typeof cursor.id !== 'string' ||
    !isUuid(cursor.id)
  ) {
    return false
  }
  const date = new Date(`${cursor.entryDate}T00:00:00.000Z`)
  const asOf = new Date(cursor.asOf)
  const createdAt = new Date(cursor.createdAt)
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === cursor.entryDate &&
    Number.isFinite(asOf.getTime()) &&
    asOf.toISOString() === cursor.asOf &&
    Number.isFinite(createdAt.getTime()) &&
    createdAt.toISOString() === cursor.createdAt &&
    createdAt <= asOf
  )
}

function mergeLevel(current: TreeNode[], incoming: TreeNode[]): TreeNode[] {
  const merged = current.map((node) => ({
    ...node,
    ...(node.children ? { children: [...node.children] } : {}),
  }))
  const byKey = new Map(merged.map((node, index) => [node.key, index]))

  for (const next of incoming) {
    const index = byKey.get(next.key)
    if (index === undefined) {
      byKey.set(next.key, merged.length)
      merged.push(next)
      continue
    }

    const existing = merged[index]!
    // A leaf can appear in more than one server response if rows change while
    // the user is paging. Keep it once instead of inflating branch counts.
    if (existing.entryId || next.entryId) continue

    const children = mergeLevel(existing.children ?? [], next.children ?? [])
    merged[index] = {
      ...existing,
      count: children.reduce((total, child) => total + child.count, 0),
      children,
    }
  }

  return merged
}

/** Merge the next bounded server page without losing expanded branch keys. */
export function mergeTreePages(
  current: TreeNode[],
  incoming: TreeNode[],
  groupBy: GroupBy,
): TreeNode[] {
  const merged = mergeLevel(current, incoming)
  if (groupBy === 'site') return merged.sort((a, b) => a.label.localeCompare(b.label))
  if (groupBy === 'topic') {
    return merged.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }
  return merged
}
