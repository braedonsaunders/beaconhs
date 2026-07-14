import { describe, expect, it } from 'vitest'
import { attachmentIdsEqual, singlePrimaryPhoto } from './photo-field-state'

describe('photo field state', () => {
  const first = { attachmentId: 'first', filename: 'first.jpg' }
  const second = { attachmentId: 'second', filename: 'second.jpg' }

  it('preserves derived state only while the ordered attachment ids are unchanged', () => {
    expect(attachmentIdsEqual([first, second], [{ ...first }, { ...second }])).toBe(true)
    expect(attachmentIdsEqual([first, second], [second, first])).toBe(false)
    expect(attachmentIdsEqual([first], [second])).toBe(false)
    expect(attachmentIdsEqual([first], [])).toBe(false)
  })

  it('keeps only the newest primary photo for annotation', () => {
    expect(singlePrimaryPhoto([first, second])).toEqual([second])
    expect(singlePrimaryPhoto([])).toEqual([])
  })
})
