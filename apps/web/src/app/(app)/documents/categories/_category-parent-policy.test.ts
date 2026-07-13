import { describe, expect, it, vi } from 'vitest'
import { assertValidCategoryParent, InvalidCategoryParentError } from './_category-parent-policy'

describe('assertValidCategoryParent', () => {
  it('walks the ancestor chain with bounded lookups', async () => {
    const nodes = new Map([
      ['child', { id: 'child', parentId: 'root' }],
      ['root', { id: 'root', parentId: null }],
    ])
    const loadParent = vi.fn(async (id: string) => nodes.get(id) ?? null)

    await expect(
      assertValidCategoryParent({ categoryId: 'edited', parentId: 'child', loadParent }),
    ).resolves.toBeUndefined()
    expect(loadParent).toHaveBeenNthCalledWith(1, 'child')
    expect(loadParent).toHaveBeenNthCalledWith(2, 'root')
  })

  it('rejects selecting a descendant as the parent', async () => {
    const nodes = new Map([
      ['descendant', { id: 'descendant', parentId: 'edited' }],
      ['edited', { id: 'edited', parentId: null }],
    ])

    await expect(
      assertValidCategoryParent({
        categoryId: 'edited',
        parentId: 'descendant',
        loadParent: async (id) => nodes.get(id) ?? null,
      }),
    ).rejects.toThrow(InvalidCategoryParentError)
  })

  it('rejects missing or deleted parents', async () => {
    await expect(
      assertValidCategoryParent({
        categoryId: 'edited',
        parentId: 'missing',
        loadParent: async () => null,
      }),
    ).rejects.toThrow('not available')
  })

  it('terminates and rejects a pre-existing ancestor cycle', async () => {
    const nodes = new Map([
      ['a', { id: 'a', parentId: 'b' }],
      ['b', { id: 'b', parentId: 'a' }],
    ])

    await expect(
      assertValidCategoryParent({
        categoryId: 'edited',
        parentId: 'a',
        loadParent: async (id) => nodes.get(id) ?? null,
      }),
    ).rejects.toThrow('invalid category cycle')
  })
})
