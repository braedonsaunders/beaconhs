type CategoryParentNode = {
  id: string
  parentId: string | null
}

export class InvalidCategoryParentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCategoryParentError'
  }
}

/**
 * Validate a proposed parent without materializing the tenant's category tree.
 * The caller supplies a bounded one-row lookup so even very large trees remain
 * safe to edit. A visited set also makes pre-existing corrupt cycles terminate
 * deterministically instead of looping forever.
 */
export async function assertValidCategoryParent({
  categoryId,
  parentId,
  loadParent,
}: {
  categoryId: string | null
  parentId: string | null
  loadParent: (id: string) => Promise<CategoryParentNode | null>
}): Promise<void> {
  if (!parentId) return

  const visited = new Set<string>()
  let cursor: string | null = parentId

  while (cursor) {
    if (cursor === categoryId) {
      throw new InvalidCategoryParentError('A category cannot be nested under itself or a child.')
    }
    if (visited.has(cursor)) {
      throw new InvalidCategoryParentError(
        'The selected parent belongs to an invalid category cycle.',
      )
    }
    visited.add(cursor)

    const row = await loadParent(cursor)
    if (!row) {
      throw new InvalidCategoryParentError('The selected parent category is not available.')
    }
    cursor = row.parentId
  }
}
